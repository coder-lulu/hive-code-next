import { linkSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

/** Cross-device history stays at source; resume still requires a trusted, verified home. */
export function canBridgeCodexSessionRoots(sourceRoot: string, targetRoot: string): boolean {
  const sourceDevice = existingAncestorDevice(sourceRoot)
  const targetDevice = existingAncestorDevice(targetRoot)
  return sourceDevice === null || targetDevice === null || sourceDevice === targetDevice
}

function existingAncestorDevice(filePath: string): number | null {
  let candidate = filePath
  while (true) {
    try {
      return statSync(candidate).dev
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return null
      }
      const parent = dirname(candidate)
      if (parent === candidate) {
        return null
      }
      candidate = parent
    }
  }
}

export function tryHardlinkCodexSessionFile(sourcePath: string, targetPath: string): boolean {
  try {
    // Codex resume ignores symlinked JSONL sessions; hardlinks keep one resumable log.
    linkSync(sourcePath, targetPath)
    return true
  } catch {
    return false
  }
}

export function linkCodexSessionFile(sourcePath: string, targetPath: string): boolean {
  try {
    // Codex ignores symlinked rollouts, even on hosts that permit creating them.
    linkSync(sourcePath, targetPath)
    return true
  } catch (error) {
    console.warn('[codex-session-bridge] Failed to link Codex session:', sourcePath, error)
  }
  return false
}
