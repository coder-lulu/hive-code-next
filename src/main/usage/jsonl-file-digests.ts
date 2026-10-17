import { createReadStream } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  readJsonlSnapshotRange,
  releaseJsonlReadStream,
  type JsonlFileSnapshot
} from './jsonl-file-snapshot'
export const CHECKPOINT_WINDOW_BYTES = 4096
type JsonlDigestReader = { handle: FileHandle; stats: JsonlFileSnapshot }

export async function readWindowDigest(
  filePath: string,
  start: number,
  endExclusive: number,
  reader?: JsonlDigestReader
): Promise<string | null> {
  const expectedBytes = endExclusive - start
  const hash = createHash('sha256')
  let readBytes = 0
  if (expectedBytes === 0) {
    return `0:${hash.digest('hex')}`
  }
  if (reader) {
    const buffer = await readJsonlSnapshotRange(
      filePath,
      reader.handle,
      reader.stats,
      start,
      endExclusive
    )
    if (!buffer) {
      return null
    }
    hash.update(buffer)
    return `${buffer.length}:${hash.digest('hex')}`
  }
  const range = { start, end: endExclusive - 1 }
  const stream = createReadStream(filePath, range)
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      hash.update(buffer)
      readBytes += buffer.length
    }
  } finally {
    await releaseJsonlReadStream(stream)
  }
  return readBytes === expectedBytes ? `${expectedBytes}:${hash.digest('hex')}` : null
}

export async function readPrefixDigests(
  filePath: string,
  parsedBytes: number,
  carriedHeadDigest: string | null = null,
  reader?: JsonlDigestReader
): Promise<{ headDigest: string; boundaryDigest: string } | null> {
  const headBytes = Math.min(CHECKPOINT_WINDOW_BYTES, parsedBytes)
  const headDigest = carriedHeadDigest?.startsWith(`${headBytes}:`)
    ? carriedHeadDigest
    : await readWindowDigest(filePath, 0, headBytes, reader)
  if (headDigest === null) {
    return null
  }
  const boundaryDigest = await readWindowDigest(
    filePath,
    Math.max(0, parsedBytes - CHECKPOINT_WINDOW_BYTES),
    parsedBytes,
    reader
  )
  return boundaryDigest === null ? null : { headDigest, boundaryDigest }
}
