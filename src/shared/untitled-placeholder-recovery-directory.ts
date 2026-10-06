import { lstat, realpath, readFile, mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from './app-environment'
import { resolveGitCommonDirectory } from './git-common-directory'
import { restrictWindowsPathAsync } from './secure-path-windows-acl'

export class UntitledPlaceholderRecoveryLocationUnavailableError extends Error {
  constructor(message = 'A private recovery location on this filesystem is unavailable') {
    super(message)
    this.name = 'UntitledPlaceholderRecoveryLocationUnavailableError'
  }
}

async function prepareRecoveryRoot(parent: string, name: string): Promise<string> {
  const root = join(parent, name)
  try {
    await mkdir(root, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
  const [parentStats, rootStats] = await Promise.all([
    lstat(parent, { bigint: true }),
    lstat(root, { bigint: true })
  ])
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || rootStats.dev !== parentStats.dev) {
    throw new Error('A private recovery directory is unavailable')
  }
  if (process.platform === 'win32') {
    if (!(await restrictWindowsPathAsync(root, true))) {
      throw new Error('Private recovery ACL is unavailable')
    }
  } else if ((rootStats.mode & 0o077n) !== 0n) {
    throw new Error('Private recovery permissions are unavailable')
  }
  const after = await lstat(root, { bigint: true })
  if (!after.isDirectory() || after.dev !== rootStats.dev || after.ino !== rootStats.ino) {
    throw new Error('Recovery directory identity changed')
  }
  return root
}

function inside(path: string, root: string): boolean {
  const part = relative(root, path)
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`))
}

/** Find existing host metadata; a missing or malformed layout never creates an inferred .git. */
async function gitMetadata(
  sourceParent: string,
  verifyOuter = true
): Promise<{ root: string; metadata: string } | null> {
  let directory = sourceParent
  for (;;) {
    const metadata = await resolveGitCommonDirectory(directory)
    if (metadata) {
      const canonical = await realpath(metadata)
      const [head, objects] = await Promise.all([
        readFile(join(canonical, 'HEAD'), 'utf8'),
        lstat(join(canonical, 'objects'))
      ])
      if (
        !/^(?:ref: refs\/[^\r\n]+|[0-9a-f]{40}|[0-9a-f]{64})\r?\n?$/.test(head) ||
        !objects.isDirectory()
      ) {
        throw new Error('Git recovery metadata is unavailable')
      }
      const part = relative(directory, canonical)
      // A separate git-dir inside the worktree is not inherently excluded from Git add.
      if (inside(canonical, directory) && !part.split(sep).includes('.git')) {
        throw new Error('Git recovery metadata is inside the committable worktree')
      }
      if (verifyOuter) {
        const outer = await gitMetadata(dirname(canonical), false)
        if (
          outer &&
          inside(canonical, outer.root) &&
          !relative(outer.root, canonical).split(sep).includes('.git')
        ) {
          throw new Error('Git recovery metadata is inside another committable worktree')
        }
      }
      return { root: directory, metadata: canonical }
    }
    const parent = dirname(directory)
    if (parent === directory) {
      return null
    }
    directory = parent
  }
}

/**
 * A retained file is product recovery state. Keep it out of the project's committable tree,
 * on the source filesystem; the retention host separately proves the private root and identity.
 */
export async function resolveUntitledPlaceholderRetentionRoot(filePath: string): Promise<string> {
  const sourceParent = await realpath(dirname(resolve(filePath)))
  const sourceStats = await lstat(sourceParent, { bigint: true })
  const metadata = await gitMetadata(sourceParent)
  if (hasAppEnvironment()) {
    try {
      const userData = await realpath(getAppEnvironment().getPath('userData'))
      const stats = await lstat(userData, { bigint: true })
      if (
        stats.isDirectory() &&
        stats.dev === sourceStats.dev &&
        !inside(userData, metadata?.root ?? sourceParent) &&
        !(await gitMetadata(userData))
      ) {
        return await prepareRecoveryRoot(userData, 'untitled-placeholder-recovery')
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw error
      }
      // Only a proved missing app directory can proceed to the known-no-location outcome.
    }
  }
  if (metadata) {
    const stats = await lstat(metadata.metadata, { bigint: true })
    if (stats.isDirectory() && stats.dev === sourceStats.dev) {
      return prepareRecoveryRoot(metadata.metadata, 'hivecode-untitled-placeholder-recovery')
    }
  }
  throw new UntitledPlaceholderRecoveryLocationUnavailableError()
}
