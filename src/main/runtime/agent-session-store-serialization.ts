import type { AgentSessionStoreState } from './agent-session-store-contract'
import { serializeAgentSessionTabTable } from './agent-session-tab-table'

export function serializeAgentSessionStoreState(state: AgentSessionStoreState): string {
  const records: Record<string, unknown> = Object.create(null)
  for (const [sessionId, record] of state.records) {
    records[sessionId] = record
  }
  const serialized: Record<string, unknown> = {
    schemaVersion: state.schemaVersion,
    hostId: state.hostId,
    records,
    operations: Object.fromEntries(state.operations),
    retiredClaimKeys: state.retiredClaimKeys,
    unusableRecords: Object.fromEntries(state.unreadableRecords)
  }
  if (state.sessionTabs) {
    Object.assign(serialized, serializeAgentSessionTabTable(state.sessionTabs))
  }
  serialized.hiveSessions = Object.fromEntries(state.hiveSessions ?? [])
  serialized.taskExecutions = Object.fromEntries(state.taskExecutions ?? [])
  if (state.taskRecoveryBlocked) {
    serialized.taskRecoveryBlocked = true
  }
  if (state.hiveRecoveryFenceAt !== undefined) {
    serialized.hiveRecoveryFenceAt = state.hiveRecoveryFenceAt
  }
  return JSON.stringify(serialized)
}
