import { closeSync, constants, fstatSync, lstatSync, openSync, type Stats } from 'node:fs'
import { lstat, open, type FileHandle } from 'node:fs/promises'
import { Readable } from 'node:stream'

const SAFE_READ_FLAGS =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
const NEEDS_PATH_PRECHECK = constants.O_NOFOLLOW === undefined || constants.O_NONBLOCK === undefined

function isRegularTranscript(stats: Stats): boolean {
  return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1
}

function sameRegularTranscript(opened: Stats, named: Stats): boolean {
  return (
    isRegularTranscript(opened) &&
    isRegularTranscript(named) &&
    opened.dev === named.dev &&
    opened.ino === named.ino
  )
}

/** Open a transcript without a path-stat/open race and reject anything stream-like. */
export function openRegularTranscript(path: string): { fd: number; stats: Stats } | undefined {
  let fd: number | undefined
  try {
    // Windows does not expose O_NOFOLLOW or O_NONBLOCK. Reject non-files before
    // open and check path identity again against the descriptor afterward.
    const before = NEEDS_PATH_PRECHECK ? lstatSync(path) : undefined
    if (before && !isRegularTranscript(before)) {
      return undefined
    }
    fd = openSync(path, SAFE_READ_FLAGS)
    const stats = fstatSync(fd)
    const pathStats = lstatSync(path)
    if (
      !sameRegularTranscript(stats, pathStats) ||
      (before && !sameRegularTranscript(stats, before))
    ) {
      closeSync(fd)
      return undefined
    }
    return { fd, stats }
  } catch {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // Preserve the original fail-closed result.
      }
    }
    return undefined
  }
}

export async function openRegularTranscriptFile(path: string): Promise<FileHandle> {
  const before = NEEDS_PATH_PRECHECK ? await lstat(path) : undefined
  if (before && !isRegularTranscript(before)) {
    throw new Error('Unsafe transcript file')
  }
  const handle = await open(path, SAFE_READ_FLAGS)
  try {
    const stats = await handle.stat()
    const named = await lstat(path)
    if (!sameRegularTranscript(stats, named) || (before && !sameRegularTranscript(stats, before))) {
      throw new Error('Unsafe transcript file')
    }
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

export async function readRegularTranscriptFile(
  path: string,
  encoding: BufferEncoding
): Promise<string> {
  const handle = await openRegularTranscriptFile(path)
  try {
    return await handle.readFile(encoding)
  } finally {
    await handle.close()
  }
}

export function openRegularTranscriptStream(
  path: string,
  options: { start?: number; end?: number; encoding?: BufferEncoding; signal?: AbortSignal }
): Readable {
  return Readable.from(
    (async function* () {
      options.signal?.throwIfAborted()
      const handle = await openRegularTranscriptFile(path)
      try {
        yield* handle.createReadStream(options)
      } finally {
        await handle.close()
      }
    })(),
    { signal: options.signal, objectMode: false, encoding: options.encoding }
  )
}
