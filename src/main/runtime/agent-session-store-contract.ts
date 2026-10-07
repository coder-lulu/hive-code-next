import type { AgentSessionTabTable } from './agent-session-tab-table'
import type { AgentSessionOperationRow } from '../../shared/agent-session-operation-ledger'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import type { TaskExecutionRecord } from '../tasks/task-execution-record'
export type AgentSessionRecordTransition = (
  record: AgentSessionRecord,
  taskExecutions?: ReadonlyMap<string, TaskExecutionRecord>
) => AgentSessionRecord

export const AGENT_SESSION_STORE_SCHEMA_VERSION = 4 as const

export type RetiredAgentSessionClaimKey = { keyId: string; retiredAt: number }

export type AgentSessionStoreState = {
  schemaVersion: number
  hostId: string
  records: Map<string, AgentSessionRecord>
  operations: Map<string, AgentSessionOperationRow>
  retiredClaimKeys: RetiredAgentSessionClaimKey[]
  /** Rows this build cannot validate, kept with a durable refusal reason. */
  unreadableRecords: Map<string, { reason: string; raw: unknown }>
  sessionTabs: AgentSessionTabTable | null
  unrecordedSessionTabs?: AgentSessionTabTable
  hiveSessions?: Map<string, HiveAgentSessionEntry>
  hiveRecoveryFenceAt?: number
  taskExecutions?: Map<string, TaskExecutionRecord>
  taskRecoveryBlocked?: boolean
}
