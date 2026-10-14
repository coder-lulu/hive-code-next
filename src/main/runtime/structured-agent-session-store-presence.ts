import { existsSync } from 'node:fs'
import { legacyAgentSessionStorePath } from './agent-session-record-store-file'
import { journalDatabasePath } from '../native-chat/agent-session-journal/journal-host-database'
import { journalDatabaseHoldsAgentSessions } from '../native-chat/agent-session-journal/journal-database'

/** Whether this profile holds a structured chat: a record or tab in the journal database. */
export function hasPersistedStructuredAgentSessionStore(
  stateDirectory: string,
  fileExists: (path: string) => boolean = existsSync
): boolean {
  const databasePath = journalDatabasePath(stateDirectory)
  if (fileExists(databasePath)) {
    try {
      const holds = journalDatabaseHoldsAgentSessions(databasePath)
      if (holds !== undefined) {
        return holds
      }
    } catch {
      // A database that cannot be read cannot say it is empty.
      return true
    }
  }
  const filePath = legacyAgentSessionStorePath(stateDirectory)
  return fileExists(filePath) || fileExists(`${filePath}.bak`)
}
