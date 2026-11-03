import type { FileWithMtime } from '../ai-vault/session-scanner-types'

// Index and parse-cache cursors can diverge when either declines a read; track them independently.

export type SessionSearchFileIdentity = { dev: number | string; ino: number | string } | null

/** A null byteOffset marks a committed prefix that needs a whole read before it can resume. */
export type SessionSearchIndexedFile = {
  byteOffset: number | null
  mtimeMs: number
  sizeBytes: number | null
}

/** Partial writes require whole reads even when mtime and size still match. */
export function requiresWholeRead(indexed: SessionSearchIndexedFile | null): boolean {
  return indexed !== null && indexed.byteOffset === null
}

export function fileIdentity(file: FileWithMtime): SessionSearchFileIdentity {
  if (file.filesystemIdentity) {
    return storedFileIdentity(file.filesystemIdentity.dev, file.filesystemIdentity.ino)
  }
  if (
    (typeof file.dev === 'number' && !Number.isSafeInteger(file.dev)) ||
    (typeof file.ino === 'number' && !Number.isSafeInteger(file.ino))
  ) {
    throw new Error('Transcript filesystem identity was not represented exactly')
  }
  return typeof file.dev === 'number' && typeof file.ino === 'number'
    ? { dev: file.dev, ino: file.ino }
    : null
}

export function storedFileIdentity(
  dev: string | null,
  ino: string | null
): SessionSearchFileIdentity {
  const value = (part: string): number | string => {
    const canonical = String(BigInt(part))
    const numeric = Number(canonical)
    return Number.isSafeInteger(numeric) ? numeric : canonical
  }
  return dev !== null && ino !== null ? { dev: value(dev), ino: value(ino) } : null
}
