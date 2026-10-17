import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { JsonlFileReader } from './jsonl-file-checkpoint'
import { jsonlPhysicalFileId } from './jsonl-file-checkpoint'
import { CHECKPOINT_WINDOW_BYTES, readPrefixDigests } from './jsonl-file-digests'
import {
  readJsonlFileSnapshot,
  readJsonlHandleSnapshot,
  sameJsonlFileSnapshot
} from './jsonl-file-snapshot'

export type JsonlFileFingerprint = { size: number; headDigest: string; boundaryDigest: string }
type ObservedGeneration = {
  size: number
  mtimeMs: number
  ctimeMs?: number
  physicalFileId?: string | null
}

function digest(bytes: Buffer): string {
  return `${bytes.length}:${createHash('sha256').update(bytes).digest('hex')}`
}

// Captured parse bytes belong to the aggregate's snapshot, including counted partial tails.
export function captureJsonlFileFingerprint(reader: JsonlFileReader): JsonlFileFingerprint | null {
  const size = reader.stats.size
  if (reader.snapshotCheckpoint?.parsedBytes === size) {
    const { headDigest, boundaryDigest } = reader.snapshotCheckpoint
    return { size, headDigest, boundaryDigest }
  }
  if (!reader.snapshotChunks || reader.snapshotBytes !== size) {
    return null
  }
  const bytes = Buffer.concat(reader.snapshotChunks, size)
  return {
    size,
    headDigest: digest(bytes.subarray(0, CHECKPOINT_WINDOW_BYTES)),
    boundaryDigest: digest(bytes.subarray(Math.max(0, size - CHECKPOINT_WINDOW_BYTES)))
  }
}

// Bounded head/tail evidence cannot establish arbitrary middle-byte integrity.
export async function verifyJsonlFileFingerprint(
  filePath: string,
  observed: ObservedGeneration,
  fingerprint: JsonlFileFingerprint | null | undefined
): Promise<boolean> {
  if (
    !fingerprint ||
    !Number.isSafeInteger(fingerprint.size) ||
    fingerprint.size < 0 ||
    fingerprint.size !== observed.size
  ) {
    return false
  }
  const bytes = Math.min(CHECKPOINT_WINDOW_BYTES, fingerprint.size)
  const digestPattern = new RegExp(`^${bytes}:[0-9a-f]{64}$`)
  if (
    typeof fingerprint.headDigest !== 'string' ||
    typeof fingerprint.boundaryDigest !== 'string' ||
    !digestPattern.test(fingerprint.headDigest) ||
    !digestPattern.test(fingerprint.boundaryDigest)
  ) {
    return false
  }
  const handle = await open(filePath, 'r')
  try {
    const stats = await readJsonlHandleSnapshot(handle)
    if (
      stats.size !== observed.size ||
      stats.mtimeMs !== observed.mtimeMs ||
      stats.ctimeMs !== observed.ctimeMs ||
      jsonlPhysicalFileId(stats) !== observed.physicalFileId ||
      !sameJsonlFileSnapshot(stats, await readJsonlFileSnapshot(filePath))
    ) {
      return false
    }
    const digests = await readPrefixDigests(filePath, stats.size, null, { handle, stats })
    const [current, pathStats] = await Promise.all([
      readJsonlHandleSnapshot(handle),
      readJsonlFileSnapshot(filePath)
    ])
    return (
      sameJsonlFileSnapshot(stats, current) &&
      sameJsonlFileSnapshot(stats, pathStats) &&
      digests?.headDigest === fingerprint.headDigest &&
      digests?.boundaryDigest === fingerprint.boundaryDigest
    )
  } finally {
    await handle.close()
  }
}
