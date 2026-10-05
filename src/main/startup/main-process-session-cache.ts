import { join } from 'node:path'
import { initSessionParseCachePersistence } from '../ai-vault/session-parse-cache-persistence'

export function initializeMainProcessSessionParseCache(
  canonicalUserDataPath: string,
  appVersion: string
): void {
  initSessionParseCachePersistence({
    filePath: join(canonicalUserDataPath, 'ai-vault', 'session-parse-cache.json'),
    appVersion
  })
}
