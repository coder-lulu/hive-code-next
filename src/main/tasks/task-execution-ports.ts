import type { AgentLaunchResult } from '../../shared/agent-launch-intent'
import type { TaskDeliveryToken } from '../../shared/task-execution/task-command-delivery'
import type {
  TaskExecutionCancel,
  TaskExecutionStart
} from '../../shared/task-execution/task-execution-command'
import type { TaskExecutionRecord, TaskExecutionWorkspace } from './task-execution-record'
import type { TaskExecutionPersistence } from './task-execution-store'

export type TaskExecutionCaller = Readonly<{
  operationCallerKey: string
  delivery?: TaskDeliveryToken
  // Private host lifetime guard; transport JSON cannot provide it.
  assertCurrent?: () => void
}>
export type TaskExecutionAction = 'start' | 'observe' | 'cancel' | 'reconcile'
export type TaskExecutionAuthorization = {
  workspace: TaskExecutionWorkspace
  input: string
  assertCurrent: () => void
}
export type TaskExecutionStopEvidence = {
  runtimeRecordId: string
  ownershipEpoch: number
  executionId: string
  executionEpoch: number
  commandFingerprint: string
  workspaceExecutionClaimRef: string
  writeFence: number
  operationId: string
  operationCallerKey: string
  evidenceKind: 'not_started' | 'stopped'
  managedToolsSettled: true
  writersFenced: true
}
export type TaskExecutionCandidate = {
  outcomeRef: string
  artifactRefs: string[]
  status?: 'succeeded' | 'failed'
}
export type TaskExecutionHostDependencies = {
  store: TaskExecutionPersistence
  capabilities: () => unknown
  resolveStart?: (command: TaskExecutionCancel) => TaskExecutionStart | null
  authorize: (
    caller: TaskExecutionCaller,
    command: TaskExecutionStart,
    action: TaskExecutionAction
  ) => Promise<TaskExecutionAuthorization>
  launch: (
    record: TaskExecutionRecord,
    authorization: TaskExecutionAuthorization
  ) => Promise<AgentLaunchResult>
  stop: (record: TaskExecutionRecord) => Promise<TaskExecutionStopEvidence | null>
  collect: (record: TaskExecutionRecord) => Promise<TaskExecutionCandidate | null>
  now?: () => number
  evidenceTimeoutMs?: number
}
