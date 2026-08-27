import { statSync } from 'node:fs'
import path from 'node:path'
import type { LinuxRootPackageType } from '../shared/update-status-types'

// Why: an absolute but user-writable PATH entry must never be treated as a trusted package manager.
const TRUSTED_EXECUTABLE_DIRECTORIES = ['/usr/bin', '/bin', '/usr/sbin', '/sbin']

const DEB_PACKAGE_MANAGERS: { name: string; args: string[] }[] = [
  { name: 'apt', args: ['install', '--'] },
  { name: 'dpkg', args: ['-i', '--'] }
]

// No `--` terminator: these tools do not accept one. Safe because capture requires an absolute path,
// so the argument can never be read as an option.
const RPM_PACKAGE_MANAGERS: { name: string; args: string[] }[] = [
  {
    name: 'zypper',
    args: ['--no-refresh', 'install', '--allow-unsigned-rpm', '-f']
  },
  { name: 'dnf', args: ['install', '--nogpgcheck'] },
  { name: 'yum', args: ['install', '--nogpgcheck'] },
  { name: 'rpm', args: ['-Uvh'] }
]

export type LinuxPackageInstallCommandResult =
  | { ok: true; command: string }
  | {
      ok: false
      reason:
        | 'no-sudo'
        | 'no-package-manager'
        | 'invalid-package-path'
        | 'no-integrity-checker'
        | 'no-secure-staging-tools'
        | 'invalid-package-digest'
    }

type LinuxPackageInstallCommandOptions = {
  expectedSha512?: string
}

/** POSIX single-quoting: the only metacharacter left is `'`, closed and re-opened around a literal. */
export function quoteForPosixShell(value: string): string {
  return `'${value.split("'").join(`'"'"'`)}'`
}

/**
 * Resolves an executable strictly from the trusted system directories. A symlink inside those
 * directories is fine — its target is what `statSync` checks — but nothing outside them is consulted
 * and no shell is ever invoked for discovery.
 */
export function resolveTrustedExecutable(name: string): string | null {
  for (const directory of TRUSTED_EXECUTABLE_DIRECTORIES) {
    // posix.join: these are POSIX paths, and this module only ever runs on Linux.
    const candidate = path.posix.join(directory, name)
    try {
      const stats = statSync(candidate)
      if (stats.isFile() && (stats.mode & 0o111) !== 0) {
        return candidate
      }
    } catch {
      // Absent here; keep looking in the remaining trusted directories.
    }
  }
  return null
}

/**
 * Builds the interactive command the user pastes into their own terminal. Every token except the
 * package path is a fixed literal, and the path is POSIX-single-quoted — the app never runs this.
 *
 * When expectedSha512 is present, FD 3 pins the cache inode while sudo copies its bytes into a
 * root-owned temporary file. That immutable handoff is hashed after the copy and is the only path
 * opened by the privileged package manager, so same-UID code cannot change bytes after verification.
 */
export function buildLinuxPackageInstallCommand(
  packageType: LinuxRootPackageType,
  packagePath: string,
  options: LinuxPackageInstallCommandOptions = {}
): LinuxPackageInstallCommandResult {
  // Why: several package managers accept no `--` terminator, so a relative or dash-leading path would
  // be read as an option. Hold that property here rather than relying on a caller two modules away.
  if (!path.isAbsolute(packagePath)) {
    return { ok: false, reason: 'invalid-package-path' }
  }
  const sudoPath = resolveTrustedExecutable('sudo')
  if (!sudoPath) {
    return { ok: false, reason: 'no-sudo' }
  }
  let expectedDigestHex: string | null = null
  let integrityCheckerPath: string | null = null
  let secureStagingTools: {
    shellPath: string
    mktempPath: string
    copyPath: string
    removePath: string
  } | null = null
  if (options.expectedSha512 !== undefined) {
    const trimmed = options.expectedSha512.trim()
    const decoded = Buffer.from(trimmed, 'base64')
    if (decoded.byteLength !== 64 || decoded.toString('base64') !== trimmed) {
      return { ok: false, reason: 'invalid-package-digest' }
    }
    expectedDigestHex = decoded.toString('hex')
    integrityCheckerPath = resolveTrustedExecutable('sha512sum')
    if (!integrityCheckerPath) {
      return { ok: false, reason: 'no-integrity-checker' }
    }
    const shellPath = resolveTrustedExecutable('sh')
    const mktempPath = resolveTrustedExecutable('mktemp')
    const copyPath = resolveTrustedExecutable('cp')
    const removePath = resolveTrustedExecutable('rm')
    if (!shellPath || !mktempPath || !copyPath || !removePath) {
      return { ok: false, reason: 'no-secure-staging-tools' }
    }
    secureStagingTools = { shellPath, mktempPath, copyPath, removePath }
  }

  // apt/dnf/yum/zypper may canonicalize or reopen a local path. Pinned commands use the low-level
  // package tools, which accept the procfd path directly and therefore retain inode identity.
  const candidates = expectedDigestHex
    ? packageType === 'deb'
      ? DEB_PACKAGE_MANAGERS.filter(({ name }) => name === 'dpkg')
      : RPM_PACKAGE_MANAGERS.filter(({ name }) => name === 'rpm')
    : packageType === 'deb'
      ? DEB_PACKAGE_MANAGERS
      : RPM_PACKAGE_MANAGERS
  for (const candidate of candidates) {
    const managerPath = resolveTrustedExecutable(candidate.name)
    if (!managerPath) {
      continue
    }
    // No -y/--noconfirm: the user must see and confirm the privileged transaction.
    const packageArgument = expectedDigestHex ? '"$staged"' : quoteForPosixShell(packagePath)
    const managerCommand = [sudoPath, managerPath, ...candidate.args, packageArgument].join(' ')
    if (!expectedDigestHex || !integrityCheckerPath || !secureStagingTools) {
      return { ok: true, command: managerCommand }
    }
    const { shellPath, mktempPath, copyPath, removePath } = secureStagingTools
    const stagingScript = [
      'exec 3< "$1"',
      `staged=$(${sudoPath} ${mktempPath} /var/tmp/desktop-update.XXXXXXXXXX)`,
      `cleanup() { ${sudoPath} ${removePath} -f -- "$staged"; }`,
      'terminate() { exit 128; }',
      'trap cleanup EXIT',
      'trap terminate HUP INT TERM',
      `${sudoPath} ${copyPath} -- "/proc/$$/fd/3" "$staged"`,
      `actual=$(${sudoPath} ${integrityCheckerPath} -- "$staged")`,
      '[ "${actual%% *}" = "$2" ]',
      managerCommand
    ].join('\n')
    return {
      ok: true,
      command: [
        shellPath,
        '-eu',
        '-c',
        quoteForPosixShell(stagingScript),
        quoteForPosixShell('desktop-updater'),
        quoteForPosixShell(packagePath),
        quoteForPosixShell(expectedDigestHex)
      ].join(' ')
    }
  }
  return { ok: false, reason: 'no-package-manager' }
}
