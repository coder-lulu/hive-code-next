import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Equal inode, size and timestamps do not prove equal code bytes on every filesystem.
// Re-read inventoried code for each integrity check; the inventory excludes the runtime image.
export function hashDaemonHostFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
