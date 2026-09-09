import {
  agentSessionOperationKey,
  isAgentSessionOperationRow
} from '../../shared/agent-session-operation-ledger'
import {
  AGENT_SESSION_RECORD_SCHEMA_VERSION,
  isAgentSessionRecord
} from '../../shared/agent-session-record'
import { hiveAgentSessionEntrySchema } from '../../shared/hive-agent-session-entry'
import { parseVisibleSessionIds } from './agent-session-visible-tab-index'
import {
  AGENT_SESSION_STORE_SCHEMA_VERSION,
  type AgentSessionStoreState,
  type RetiredAgentSessionClaimKey
} from './agent-session-record-store-file'

export function emptyState(hostId: string): AgentSessionStoreState {
  return {
    schemaVersion: AGENT_SESSION_STORE_SCHEMA_VERSION,
    hostId,
    records: new Map(),
    operations: new Map(),
    retiredClaimKeys: [],
    unreadableRecords: new Map(),
    visibleSessionIds: new Set(),
    visibleSessionIdsIndexPresent: false,
    hiveSessions: new Map()
  }
}

export function parseState(
  raw: string,
  hostId: string
): { state: AgentSessionStoreState; needsRewrite: boolean } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const file = parsed as {
    schemaVersion?: unknown
    hostId?: unknown
    records?: unknown
    operations?: unknown
    retiredClaimKeys?: unknown
    unusableRecords?: unknown
    visibleSessionIds?: unknown
    hiveSessions?: unknown
    hiveRecoveryFenceAt?: unknown
  }
  if (
    !Number.isSafeInteger(file.schemaVersion) ||
    (file.schemaVersion as number) < 0 ||
    typeof file.hostId !== 'string'
  ) {
    return null
  }
  const schemaVersion = file.schemaVersion as number
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
    schemaVersion === AGENT_SESSION_STORE_SCHEMA_VERSION ||
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
      const record = isAgentSessionRecord(value) ? value : null
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
  const visibleSessionIds = parseVisibleSessionIds(
    file.visibleSessionIds,
    Math.max(schemaVersion, AGENT_SESSION_STORE_SCHEMA_VERSION),
    AGENT_SESSION_STORE_SCHEMA_VERSION
  )
  if (!visibleSessionIds.valid) {
    return null
  }
  state.visibleSessionIdsIndexPresent = visibleSessionIds.present
  visibleSessionIds.ids.forEach((sessionId) => state.visibleSessionIds.add(sessionId))
  return { state, needsRewrite }
}
