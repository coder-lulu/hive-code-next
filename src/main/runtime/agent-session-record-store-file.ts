/**
 * The records file the agent-session store kept before it moved into the chat journal database,
 * read once by the version-4 migration (agent-session-legacy-record-import.ts) and never written.
 * Its `.bak` fallback and salvage survive here for that one read, until the import is retired.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isRecord } from '../../shared/agent-status-child-work-value-guards'
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

/** A native backup cannot replace evidence that this session belonged to a retired executor. */
export function hasRetiredTaskSessionProvenance(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.provider === 'managed-pi' ||
      value.provider === 'hivecode' ||
      (Array.isArray(value.providerHandleChain) &&
        value.providerHandleChain.some(
          (link: unknown) =>
            isRecord(link) &&
            isRecord(link.handle) &&
            (link.handle.provider === 'managed-pi' ||
              link.handle.provider === 'hivecode' ||
              link.handle.transport === 'managed-pi' ||
              link.handle.agent === 'managed-pi' ||
              link.handle.agent === 'hivecode')
        )) ||
      Object.hasOwn(value, 'taskSource') ||
      (isRecord(value.lease) &&
        isRecord(value.lease.deathEvidence) &&
        value.lease.deathEvidence.kind === 'execution-host-exit-observed'))
  )
}

/** Keep source evidence even when unrelated metadata makes the primary require a backup. */
function collectRetiredTaskSessionRecords(raw: string, records: Map<string, unknown>): void {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }
  if (!isRecord(value)) {
    return
  }
  const retain = (sessionId: string, record: unknown) => {
    if (!records.has(sessionId) && hasRetiredTaskSessionProvenance(record)) {
      records.set(sessionId, record)
    }
  }
  if (isRecord(value.records)) {
    for (const [sessionId, record] of Object.entries(value.records)) {
      retain(sessionId, record)
    }
  }
  if (isRecord(value.unusableRecords)) {
    for (const [sessionId, entry] of Object.entries(value.unusableRecords)) {
      if (isRecord(entry)) {
        retain(sessionId, entry.raw)
      }
    }
  }
}

/** Both whole-file fallback and per-record salvage retain the same source evidence. */
function parseStateRetainingRetiredRecords(
  raw: string,
  hostId: string,
  retiredRecords: Map<string, unknown>
): ReturnType<typeof parseState> {
  collectRetiredTaskSessionRecords(raw, retiredRecords)
  const parsed = parseState(raw, hostId)
  if (parsed) {
    for (const [sessionId, raw] of retiredRecords) {
      parsed.state.records.delete(sessionId)
      parsed.state.unreadableRecords.set(sessionId, { reason: 'current_shape_invalid', raw })
    }
  }
  return parsed
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
    (sessionId) =>
      !state.records.has(sessionId) &&
      !hasRetiredTaskSessionProvenance(state.unreadableRecords.get(sessionId)?.raw)
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
  const retiredRecords = new Map<string, unknown>()
  const backup = parseStateRetainingRetiredRecords(raw, hostId, retiredRecords)
  for (const sessionId of missing) {
    if (retiredRecords.has(sessionId)) {
      state.unreadableRecords.set(sessionId, {
        reason: 'current_shape_invalid',
        raw: retiredRecords.get(sessionId)
      })
      continue
    }
    const record = backup?.state.records.get(sessionId)
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
  const retiredRecords = new Map<string, unknown>()
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
    const parsed = parseStateRetainingRetiredRecords(raw, hostId, retiredRecords)
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
