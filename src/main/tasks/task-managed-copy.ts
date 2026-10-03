import { constants, lstatSync, realpathSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, opendir, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { readNodeFileHandleWithinLimit } from '../../shared/node-bounded-file-reader'
import { isWslUncPath } from '../../shared/wsl-paths'
import { refuseTaskExecution } from './task-execution-error'
import { taskLaunchPathKey } from './task-launch-workspace'

const OMITTED_DIRECTORIES = new Set(['.git', 'node_modules', 'logs'])
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_ENTRIES = 20_000
const within = (root: string, path: string) => {
  const suffix = relative(root, path)
  return suffix !== '' && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`)
}

/** Copy source files, including dirty/untracked files, without Git mutations or shared inodes. */
export async function createTaskManagedCopy(options: {
  source: string
  directory: string
  assertCurrent: () => void
}) {
  options.assertCurrent()
  if (
    !isAbsolute(options.source) ||
    (process.platform === 'win32' && isWslUncPath(options.source))
  ) {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  const source = await realpath(options.source)
  await mkdir(options.directory, { recursive: true, mode: 0o700 })
  const directory = await realpath(options.directory)
  if (!lstatSync(source).isDirectory() || within(source, directory) || source === directory) {
    return refuseTaskExecution('FORBIDDEN')
  }
  const target = await mkdtemp(join(directory, 'execution-'))
  let count = 0
  let bytes = 0
  const assertCurrent = () => {
    options.assertCurrent()
    for (const path of [source, target]) {
      if (
        lstatSync(path).isSymbolicLink() ||
        taskLaunchPathKey(realpathSync(path)) !== taskLaunchPathKey(path)
      ) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
  }
  const copyDirectory = async (from: string, to: string, depth: number): Promise<void> => {
    if (depth > 64) {
      return refuseTaskExecution('CAPACITY_EXCEEDED')
    }
    assertCurrent()
    const entries = await opendir(from)
    for await (const entry of entries) {
      assertCurrent()
      if (++count > MAX_ENTRIES) {
        return refuseTaskExecution('CAPACITY_EXCEEDED')
      }
      if (OMITTED_DIRECTORIES.has(entry.name) && (entry.isDirectory() || entry.name === '.git')) {
        continue
      }
      const path = join(from, entry.name)
      const destination = join(to, entry.name)
      const before = await lstat(path)
      if (
        before.isSymbolicLink() ||
        taskLaunchPathKey(await realpath(path)) !== taskLaunchPathKey(path)
      ) {
        return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
      }
      if (before.isDirectory()) {
        await mkdir(destination, { mode: 0o700 })
        await copyDirectory(path, destination, depth + 1)
      } else if (before.isFile()) {
        const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        try {
          const contents = await readNodeFileHandleWithinLimit(handle, MAX_FILE_BYTES)
          const after = await lstat(path)
          if (
            contents.stats.ino !== before.ino ||
            after.ino !== before.ino ||
            after.mtimeMs !== before.mtimeMs ||
            after.size !== before.size ||
            after.isSymbolicLink()
          ) {
            return refuseTaskExecution('REVISION_CONFLICT')
          }
          bytes += contents.buffer.byteLength
          if (bytes > MAX_TOTAL_BYTES) {
            return refuseTaskExecution('CAPACITY_EXCEEDED')
          }
          assertCurrent()
          await writeFile(destination, contents.buffer, { flag: 'wx', mode: before.mode & 0o777 })
        } finally {
          await handle.close()
        }
      } else {
        return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
      }
    }
  }
  try {
    await copyDirectory(source, target, 0)
    assertCurrent()
    return Object.freeze({ canonicalPath: source, executionPath: target, assertCurrent })
  } catch (error) {
    // Only an unlaunched directory minted by this call may be discarded.
    if (within(directory, target) && !lstatSync(target).isSymbolicLink()) {
      await rm(target, { recursive: true, force: true })
    }
    throw error
  }
}
