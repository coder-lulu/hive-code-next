import {
  chmod,
  cp,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  makeTreeReadOnlyAsync,
  shareTreeAsync
} from '../../../config/scripts/space-sharing-copy.mjs'
import { extractReleaseCheckoutTree } from './release-checkout-tree.ts'
import { installMissingPackageStandIns, type PackageImports } from './release-missing-packages.ts'
import { publishReleaseCheckout } from './release-checkout-publication.ts'
import { pruneSharedReleaseSources, withReleaseSourceLease } from './release-source-retention.ts'

const IMPORTS_FILENAME = 'release-package-imports.json'

export async function populateReleaseCheckoutSource(
  repoRoot: string,
  staging: string,
  commit: string,
  sharedCacheRoot: string | undefined
): Promise<void> {
  if (sharedCacheRoot) {
    try {
      await populateFromSharedReleaseSource(repoRoot, staging, commit, sharedCacheRoot)
      return
    } catch (error) {
      console.warn(
        `[cross-version] Shared release source unavailable; extracting locally: ${String(error)}`
      )
      await rm(staging, { recursive: true, force: true })
      await mkdir(staging, { recursive: true })
    }
  }
  await extractReleaseCheckoutTree(repoRoot, staging, commit)
}

function readPackageImports(value: unknown): PackageImports {
  if (!Array.isArray(value)) {
    throw new Error('Invalid cached release package imports')
  }
  const result: PackageImports = new Map()
  for (const entry of value) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      !Array.isArray(entry[1])
    ) {
      throw new Error('Invalid cached release package imports')
    }
    const names = entry[1].filter((name): name is string => typeof name === 'string')
    if (names.length !== entry[1].length) {
      throw new Error('Invalid cached release import names')
    }
    result.set(entry[0], new Set(names))
  }
  return result
}

export async function populateFromSharedReleaseSource(
  repoRoot: string,
  staging: string,
  commit: string,
  sharedCacheRoot: string,
  { extract = extractReleaseCheckoutTree, copy = copySharedReleaseSource } = {}
): Promise<void> {
  await withReleaseSourceLease(sharedCacheRoot, async (formatRoot, verifyLease) => {
    const seed = join(formatRoot, commit)
    try {
      await pruneSharedReleaseSources(formatRoot, commit, verifyLease)
      await publishReleaseCheckout({
        root: seed,
        ref: commit,
        commit,
        populateStaging: async (seedStaging) => {
          const imports = await extract(repoRoot, seedStaging, commit, true)
          await writeFile(
            join(seedStaging, IMPORTS_FILENAME),
            JSON.stringify([...imports].map(([specifier, names]) => [specifier, [...names]]))
          )
        },
        prepareForPublication: async (seedStaging) => {
          verifyLease()
          await makeTreeReadOnlyAsync(seedStaging)
          verifyLease()
        }
      })
      const imports = readPackageImports(
        JSON.parse(await readFile(join(seed, IMPORTS_FILENAME), 'utf8'))
      )
      const copied = join(staging, '.release-source')
      verifyLease()
      await copy(seed, copied)
      verifyLease()
      for (const entry of await readdir(copied)) {
        if (entry !== 'checkout-stamp.json' && entry !== IMPORTS_FILENAME) {
          await rename(join(copied, entry), join(staging, entry))
        }
      }
      await rm(copied, { recursive: true, force: true })
      const now = new Date()
      await utimes(seed, now, now)
      await installMissingPackageStandIns(
        staging,
        commit,
        imports,
        JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
      )
    } catch (error) {
      verifyLease()
      await rm(seed, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  })
}

export async function copySharedReleaseSource(
  source: string,
  destination: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  try {
    await shareTreeAsync(
      source,
      destination,
      platform === 'win32'
        ? {
            platform,
            hardlink: async () => {
              throw new Error('Windows removal changes hardlink permissions')
            }
          }
        : { platform }
    )
  } catch {
    await (platform === 'win32'
      ? copyReleaseSourceEntries(source, destination)
      : cp(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true }))
  }
}

// fs.cp recursively visits one file at a time. Windows must copy rather than
// hardlink, so bound independent file copies without changing their inode or mode semantics.
export async function copyReleaseSourceEntries(
  source: string,
  destination: string,
  { copy = copyFile } = {}
): Promise<void> {
  const directories = [{ source, destination }]
  const modes: { destination: string; mode: number }[] = []
  const files: { source: string; destination: string; regular: boolean }[] = []
  while (directories.length > 0) {
    const prepared = await Promise.allSettled(
      directories.splice(0, 8).map(async (directory) => {
        const mode = (await stat(directory.source)).mode
        await mkdir(directory.destination, { recursive: true })
        modes.push({ destination: directory.destination, mode })
        for (const entry of await readdir(directory.source, { withFileTypes: true })) {
          const item = {
            source: join(directory.source, entry.name),
            destination: join(directory.destination, entry.name)
          }
          if (entry.isDirectory()) {
            directories.push(item)
          } else {
            files.push({ ...item, regular: entry.isFile() })
          }
        }
      })
    )
    for (const result of prepared) {
      if (result.status === 'rejected') {
        throw result.reason
      }
    }
  }
  let next = 0
  let failed = false
  let failure: unknown
  const worker = async (): Promise<void> => {
    while (!failed) {
      const file = files[next++]
      if (!file) {
        return
      }
      try {
        await (file.regular
          ? copy(file.source, file.destination)
          : cp(file.source, file.destination, { dereference: false, verbatimSymlinks: true }))
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  if (failed) {
    throw failure
  }
  const reverseModes = modes.toReversed()
  for (let offset = 0; offset < reverseModes.length; offset += 8) {
    const applied = await Promise.allSettled(
      reverseModes
        .slice(offset, offset + 8)
        .map((directory) => chmod(directory.destination, directory.mode))
    )
    for (const result of applied) {
      if (result.status === 'rejected') {
        throw result.reason
      }
    }
  }
}

export async function resolveSharedReleaseCacheRoot(
  repoRoot: string,
  isolatedCacheRoot?: string
): Promise<string | undefined> {
  if (
    isolatedCacheRoot ||
    process.env.CI ||
    process.env.ORCA_DISABLE_SHARED_RELEASE_CACHE === '1'
  ) {
    return undefined
  }
  try {
    const { runProcess } = await import('@orca/process-host')
    const result = await runProcess({
      program: 'git',
      args: ['rev-parse', '--git-common-dir'],
      cwd: repoRoot,
      timeoutMs: 10_000,
      terminationBarrier: true
    })
    if (result.code !== 0 || result.timedOut) {
      return undefined
    }
    const common = result.stdout.replace(process.platform === 'win32' ? /\r?\n$/ : /\n$/, '')
    if (!common || common.includes('\n')) {
      return undefined
    }
    return join(resolve(repoRoot, common), 'orca-cache', 'release-source')
  } catch {
    return undefined
  }
}
