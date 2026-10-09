import { decodePersistedAgentSessionRecord } from '../../shared/agent-session-record-stored-form'
import { isRecord } from '../../shared/agent-status-child-work-value-guards'
import {
  agentSessionOperationKey,
  isAgentSessionOperationRow
} from '../../shared/agent-session-operation-ledger'
import {
  AGENT_SESSION_RECORD_SCHEMA_VERSION,
  isPersistedAgentSessionRecord
} from '../../shared/agent-session-record'
import { hiveAgentSessionEntrySchema } from '../../shared/hive-agent-session-entry'
import { parseAgentSessionTabTable } from './agent-session-tab-table'
import { TaskExecutionRecordSchema, taskExecutionRecordKey } from '../tasks/task-execution-record'
import {
  AGENT_SESSION_STORE_SCHEMA_VERSION,
  type AgentSessionStoreState,
  type RetiredAgentSessionClaimKey
} from './agent-session-store-contract'

export function emptyState(hostId: string): AgentSessionStoreState {
  return {
    schemaVersion: AGENT_SESSION_STORE_SCHEMA_VERSION,
    hostId,
    records: new Map(),
    operations: new Map(),
    retiredClaimKeys: [],
    unreadableRecords: new Map(),
    sessionTabs: null,
    hiveSessions: new Map(),
    taskExecutions: new Map()
  }
}

export function parseState(
  raw: string,
  hostId: string
): {
  state: AgentSessionStoreState
  needsRewrite: boolean
  legacyHandoffLeasesNormalized: boolean
} | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) {
    return null
  }
  const file = parsed
  if (
    typeof file.schemaVersion !== 'number' ||
    !Number.isSafeInteger(file.schemaVersion) ||
    file.schemaVersion < 0 ||
    typeof file.hostId !== 'string'
  ) {
    return null
  }
  const schemaVersion = file.schemaVersion
  if (schemaVersion < 2) {
    return null
  }
  if (
    schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION &&
    (typeof file.records !== 'object' || file.records === null || Array.isArray(file.records))
  ) {
    return null
  }
  if (
    schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION &&
    (typeof file.operations !== 'object' ||
      file.operations === null ||
      Array.isArray(file.operations) ||
      !Array.isArray(file.retiredClaimKeys) ||
      typeof file.unusableRecords !== 'object' ||
      file.unusableRecords === null ||
      Array.isArray(file.unusableRecords))
  ) {
    return null
  }
  const state = emptyState(hostId)
  state.schemaVersion = schemaVersion
  state.hostId = file.hostId
  if (
    schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION &&
    file.taskRecoveryBlocked !== undefined
  ) {
    if (typeof file.taskRecoveryBlocked !== 'boolean') {
      return null
    }
    state.taskRecoveryBlocked = file.taskRecoveryBlocked
  }
  if (
    schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION &&
    (schemaVersion === AGENT_SESSION_STORE_SCHEMA_VERSION || file.taskExecutions !== undefined)
  ) {
    if (
      !file.taskExecutions ||
      typeof file.taskExecutions !== 'object' ||
      Array.isArray(file.taskExecutions)
    ) {
      return null
    }
    for (const [key, value] of Object.entries(file.taskExecutions)) {
      const record = TaskExecutionRecordSchema.safeParse(value)
      if (!record.success || taskExecutionRecordKey(record.data.command) !== key) {
        return null
      }
      state.taskExecutions!.set(key, record.data)
    }
  }
  let legacyHandoffLeasesNormalized = false
  let needsRewrite = schemaVersion < AGENT_SESSION_STORE_SCHEMA_VERSION
  if (
    schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION &&
    file.hiveRecoveryFenceAt !== undefined
  ) {
    if (
      !Number.isSafeInteger(file.hiveRecoveryFenceAt) ||
      (file.hiveRecoveryFenceAt as number) < 0
    ) {
      return null
    }
    state.hiveRecoveryFenceAt = file.hiveRecoveryFenceAt as number
  }
  if (
    (schemaVersion >= 3 && schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION) ||
    (schemaVersion < AGENT_SESSION_STORE_SCHEMA_VERSION && file.hiveSessions !== undefined)
  ) {
    if (
      !file.hiveSessions ||
      typeof file.hiveSessions !== 'object' ||
      Array.isArray(file.hiveSessions)
    ) {
      return null
    }
    for (const [id, rawEntry] of Object.entries(file.hiveSessions)) {
      const entry = hiveAgentSessionEntrySchema.safeParse(rawEntry)
      if (!entry.success || entry.data.aggregate.session.sessionId !== id) {
        return null
      }
      state.hiveSessions!.set(id, entry.data)
    }
  }
  if (typeof file.records === 'object' && file.records !== null) {
    for (const [sessionId, value] of Object.entries(file.records)) {
      const decoded = isPersistedAgentSessionRecord(value)
        ? decodePersistedAgentSessionRecord(value)
        : null
      const record = decoded?.record ?? null
      legacyHandoffLeasesNormalized ||= decoded?.normalized === true
      if (record?.sessionId === sessionId) {
        state.records.set(sessionId, record)
      } else {
        const valueSchemaVersion =
          typeof value === 'object' &&
          value !== null &&
          (value as { schemaVersion?: unknown }).schemaVersion
        const reason = record
          ? 'record_key_session_id_mismatch'
          : valueSchemaVersion === AGENT_SESSION_RECORD_SCHEMA_VERSION
            ? 'current_shape_invalid'
            : 'unsupported_schema'
        state.unreadableRecords.set(sessionId, { reason, raw: value })
        needsRewrite ||= schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION
      }
    }
  }
  if (typeof file.unusableRecords === 'object' && file.unusableRecords !== null) {
    for (const [sessionId, value] of Object.entries(file.unusableRecords)) {
      if (typeof value !== 'object' || value === null) {
        if (schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION) {
          return null
        }
        continue
      }
      const unusable = value as { reason?: unknown; raw?: unknown }
      if (typeof unusable.reason !== 'string' || unusable.reason.length === 0) {
        if (schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION) {
          return null
        }
        continue
      }
      state.unreadableRecords.set(sessionId, { reason: unusable.reason, raw: unusable.raw })
    }
  }
  if (typeof file.operations === 'object' && file.operations !== null) {
    for (const [key, value] of Object.entries(file.operations)) {
      if (!isAgentSessionOperationRow(value)) {
        if (schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION) {
          return null
        }
        continue
      }
      if (key !== agentSessionOperationKey(value.callerKey, value.operationId)) {
        if (schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION) {
          return null
        }
        continue
      }
      state.operations.set(key, value)
    }
  }
  if (Array.isArray(file.retiredClaimKeys)) {
    for (const entry of file.retiredClaimKeys) {
      const key = entry as Partial<RetiredAgentSessionClaimKey>
      if (
        typeof key?.keyId !== 'string' ||
        key.keyId.length === 0 ||
        key.keyId.length > 512 ||
        !Number.isSafeInteger(key.retiredAt) ||
        (key.retiredAt as number) < 0
      ) {
        if (schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION) {
          return null
        }
        continue
      }
      state.retiredClaimKeys.push({ keyId: key.keyId, retiredAt: key.retiredAt as number })
    }
  }
  if (
    schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION &&
    file.visibleSessionIds !== undefined &&
    (!Array.isArray(file.visibleSessionIds) ||
      file.visibleSessionIds.some((id) => typeof id !== 'string' || id.length === 0))
  ) {
    return null
  }
  const sessionTabs = parseAgentSessionTabTable(
    file,
    state.records,
    schemaVersion <= AGENT_SESSION_STORE_SCHEMA_VERSION
  )
  if (!sessionTabs.valid) {
    return null
  }
  state.sessionTabs = sessionTabs.table
  return { state, needsRewrite, legacyHandoffLeasesNormalized }
}
