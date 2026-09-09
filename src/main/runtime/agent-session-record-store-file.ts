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
import { chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentSessionOperationRow } from '../../shared/agent-session-operation-ledger'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  copyFileDurable,
  durableWriteTempPath,
  renameDurable,
  writeTempFileDurable
} from '../durable-file-write'
import { serializeAgentSessionStoreState } from './agent-session-store-serialization'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'

export const AGENT_SESSION_STORE_SCHEMA_VERSION = 3 as const

export const AGENT_SESSION_STORE_FILE_NAME = 'agent-sessions.json'

export type RetiredAgentSessionClaimKey = { keyId: string; retiredAt: number }

export type AgentSessionStoreState = {
  schemaVersion: number
  hostId: string
  records: Map<string, AgentSessionRecord>
  operations: Map<string, AgentSessionOperationRow>
  retiredClaimKeys: RetiredAgentSessionClaimKey[]
  /** Rows this build cannot validate, kept with a durable refusal reason. */
  unreadableRecords: Map<string, { reason: string; raw: unknown }>
  /** Structured sessions that currently have a visible chat tab. */
  visibleSessionIds: Set<string>
  /** True once this store has committed the visibility index field. */
  visibleSessionIdsIndexPresent: boolean
  hiveSessions?: Map<string, HiveAgentSessionEntry>
  hiveRecoveryFenceAt?: number
}

export type LoadedAgentSessionStore = {
  state: AgentSessionStoreState
  storeFound: boolean
  /** True when the file was written by a newer schema; this host reads but never writes it. */
  readOnly: boolean
  /** True when the primary file was unusable and the previous committed copy was used. */
  recoveredFromBackup: boolean
  /** True when the normalized current-schema quarantine must be persisted. */
  needsRewrite: boolean
}

export function agentSessionStorePath(directory: string): string {
  return join(directory, AGENT_SESSION_STORE_FILE_NAME)
}

const backupPath = (filePath: string): string => `${filePath}.bak`

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
      state: parsed.state,
      storeFound: true,
      readOnly: parsed.state.schemaVersion > AGENT_SESSION_STORE_SCHEMA_VERSION,
      recoveredFromBackup,
      needsRewrite: parsed.needsRewrite
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
    needsRewrite: false
  }
}

/**
 * Commit the whole state. The live path is never absent: the new content is made durable in a temp
 * file first, a validated primary is COPIED to the backup, and only then does the rename publish it.
 * Backup recovery keeps the known-good backup in place while publishing the repaired primary.
 *
 * The old ordering renamed the live file aside before writing the new one, so a death in that
 * window left the profile with a backup and no primary — which is exactly the state that wedged a
 * real profile. Copy, don't move.
 */
export async function saveAgentSessionStore(
  filePath: string,
  state: AgentSessionStoreState,
  options: { primaryStatus: 'validated' | 'unusable-or-absent' }
): Promise<void> {
  const directory = dirname(filePath)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const tmpPath = durableWriteTempPath(filePath)
  try {
    await writeTempFileDurable(
      tmpPath,
      serializeAgentSessionStoreState({
        ...state,
        schemaVersion: AGENT_SESSION_STORE_SCHEMA_VERSION
      }),
      0o600
    )
    // Only a primary parsed under the transaction lock may replace the backup. During recovery the
    // primary is corrupt or absent, so the known-good backup must survive until publication.
    if (options.primaryStatus === 'validated') {
      await copyFileDurable(filePath, backupPath(filePath))
    }
    await renameDurable(tmpPath, filePath)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}
