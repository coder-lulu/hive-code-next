import { emptyState, parseState } from './agent-session-store-parsing'
/**
 * On-disk layer for the durable agent-session store.
 *
 * Every mutation is a whole-file atomic transaction — temp write, fsync, rename — so a SIGKILL
 * at any point leaves either the previous committed state or the next one, never a torn lease.
 * That matters because this host restarts its runtime often; a half-written lease would be
 * indistinguishable from an owner whose identity cannot be verified.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { agentSessionStoreBackupPath as backupPath } from './agent-session-record-store-write'
export { saveAgentSessionStore } from './agent-session-record-store-write'
import { serializeAgentSessionStoreState } from './agent-session-store-serialization'
import {
  AGENT_SESSION_STORE_SCHEMA_VERSION,
  type AgentSessionStoreState
} from './agent-session-store-contract'
export {
  AGENT_SESSION_STORE_SCHEMA_VERSION,
  type AgentSessionStoreState,
  type RetiredAgentSessionClaimKey
} from './agent-session-store-contract'

/** In a host's state directory, beside the journal database: one file adjudicates every session's
 *  lease. */
export const AGENT_SESSION_STORE_DIR_NAME = 'agent-sessions'

export const AGENT_SESSION_STORE_FILE_NAME = 'agent-sessions.json'

export type LoadedAgentSessionStore = {
  state: AgentSessionStoreState
  storeFound: boolean
  /** True when the file was written by a newer schema; this host reads but never writes it. */
  readOnly: boolean
  /** True when the primary file was unusable and the previous committed copy was used. */
  recoveredFromBackup: boolean
  /** True when the normalized current-schema quarantine must be persisted. */
  needsRewrite: boolean
  /** True when decode mapped a lease value only the removed terminal handoff wrote. */
  legacyHandoffLeasesNormalized: boolean
}

export function agentSessionStorePath(directory: string): string {
  return join(directory, AGENT_SESSION_STORE_FILE_NAME)
}

export function agentSessionStoreRevision(state: AgentSessionStoreState): string {
  return createHash('sha256')
    .update(String(state.schemaVersion))
    .update('\0')
    .update(serializeAgentSessionStoreState(state))
    .digest('hex')
}

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
        // (EACCES, EIO, EMFILE) says nothing about the primary's contents, and treating it as
        // recovery would replace newer state with a stale backup and latch the recovery path.
        if (!recoveredFromBackup) {
          throw new Error('agent_session_store_corrupt')
        }
        unusableStoreFound = true
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
    recoveredFromBackup: false,
    needsRewrite: false,
    legacyHandoffLeasesNormalized: false
  }
}
