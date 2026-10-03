import type { AuthenticatedRuntimePrincipal } from '../../shared/hive-agent-session-methods'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import type { HiveAiModelSelection } from '../../shared/hive-ai-model-catalog'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import type { HiveAiModelResolution } from '../hive-runtime-cloud/hive-ai-model-reader'
import type { AgentSessionJournal } from './agent-session-journal/journal-store'
import type { HiveAgentTextAdapter } from './hive-agent-text-adapter'
import type { HiveAgentTextPackSource } from './hive-agent-text-pack'
import type { AgentSessionOperationAdmission } from '../runtime/agent-session-operation-admission'
import type { AgentSessionOperationDecision } from '../../shared/agent-session-operation-ledger'

export type HiveAgentHostDependencies = {
  store: AgentSessionRecordStore
  runtimeRecordId: string
  executionUnavailable?: 'hive_agent_pack_unavailable'
  queryExecution?: (entry: HiveAgentSessionEntry) => Promise<unknown>
  cancelExecution?: (entry: HiveAgentSessionEntry) => Promise<unknown>
  adapter?: HiveAgentTextAdapter
  readPack?: HiveAgentTextPackSource
  resolveModel?: (
    command: Readonly<HiveAiModelSelection>,
    principal: AuthenticatedRuntimePrincipal
  ) => Promise<HiveAiModelResolution>
  journalFor: (entry: HiveAgentSessionEntry) => Promise<AgentSessionJournal>
  fenceFor: (entry: HiveAgentSessionEntry) => number
  now: () => number
  eligibilityRevision: () => number
  enabled: () => boolean
  hasSecretReference?: (reference: string) => boolean
  releaseExecution?: (sessionId: string) => Promise<void>
  closeExecution?: () => Promise<void>
}
export type HiveAgentPrincipalResolver = () => AuthenticatedRuntimePrincipal | null
export type HiveAgentOperationFactory = (
  method: string,
  params: { sessionId: string; operationId: string },
  principal: AuthenticatedRuntimePrincipal,
  fields: Record<string, unknown>
) => AgentSessionOperationAdmission
export type HiveAgentOperationReceipt = (
  decision: AgentSessionOperationDecision,
  sessionId: string
) => unknown
