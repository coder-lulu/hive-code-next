/**
 * The records file the agent-session store kept before it moved into the chat journal database,
 * read once by the version-4 migration (agent-session-legacy-record-import.ts) and never written.
 * Its `.bak` fallback and salvage survive here for that one read, until the import is retired.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { emptyState, parseState } from './agent-session-store-parsing'
import {
  AGENT_SESSION_STORE_SCHEMA_VERSION,
  type AgentSessionStoreState
} from './agent-session-store-contract'
export {
  AGENT_SESSION_STORE_SCHEMA_VERSION,
  type AgentSessionStoreState,
  type RetiredAgentSessionClaimKey
} from './agent-session-store-contract'

/** In a host's state directory, beside the journal database, where the records file lived. */
export const AGENT_SESSION_STORE_DIR_NAME = 'agent-sessions'

export const AGENT_SESSION_STORE_FILE_NAME = 'agent-sessions.json'

export type LoadedAgentSessionStore = {
  state: AgentSessionStoreState
  storeFound: boolean
  /** True when the file was written by a newer schema; this host reads but never writes it. */
  readOnly: boolean
  /** True when the primary file was unusable and the previous committed copy was used. */
  recoveredFromBackup: boolean
}

export function agentSessionStorePath(directory: string): string {
  return join(directory, AGENT_SESSION_STORE_FILE_NAME)
}

/** The records file of the host whose state directory this is. */
export function legacyAgentSessionStorePath(stateDirectory: string): string {
  return agentSessionStorePath(join(stateDirectory, AGENT_SESSION_STORE_DIR_NAME))
}

const backupPath = (filePath: string): string => `${filePath}.bak`

/** A record the primary retained as unreadable may still have a valid copy in the previous
 *  committed state. Adopting it keeps the session reachable — the lease is re-adjudicated
 *  like any other — while the unreadable bytes stay quarantined verbatim. */
async function salvageUnreadableRecordsFromBackup(
  state: AgentSessionStoreState,
  backupFilePath: string,
  hostId: string
): Promise<void> {
  const missing = [...state.unreadableRecords.keys()].filter(
    (sessionId) => !state.records.has(sessionId)
  )
  if (missing.length === 0) {
    return
  }
  let raw: string
  try {
    raw = await readFile(backupFilePath, 'utf-8')
  } catch {
    return
  }
  const backup = parseState(raw, hostId)
  if (!backup) {
    return
  }
  for (const sessionId of missing) {
    const record = backup.state.records.get(sessionId)
    if (record) {
      state.records.set(sessionId, record)
    }
  }
}

export async function loadAgentSessionStore(
  filePath: string,
  hostId: string
): Promise<LoadedAgentSessionStore> {
  let unusableStoreFound = false
  for (const [candidate, recoveredFromBackup] of [
    [filePath, false],
    [backupPath(filePath), true]
  ] as const) {
    let raw: string
    try {
      raw = await readFile(candidate, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Only a missing or unparseable primary means "fall back". A transient read failure
        // (EACCES, EIO, EMFILE) says nothing about either copy's contents: the primary is not
        // replaced by a stale backup, and a backup that could not be read is not unusable.
        throw new Error('agent_session_store_corrupt', { cause: error })
      }
      continue
    }
    const parsed = parseState(raw, hostId)
    if (!parsed) {
      unusableStoreFound = true
      continue
    }
    if (!recoveredFromBackup) {
      await salvageUnreadableRecordsFromBackup(parsed.state, backupPath(filePath), hostId)
    }
    return {
      ...parsed,
      storeFound: true,
      readOnly: parsed.state.schemaVersion > AGENT_SESSION_STORE_SCHEMA_VERSION,
      recoveredFromBackup
    }
  }
  if (unusableStoreFound) {
    throw new Error('agent_session_store_corrupt')
  }
  return {
    state: emptyState(hostId),
    storeFound: false,
    readOnly: false,
    recoveredFromBackup: false
  }
}
