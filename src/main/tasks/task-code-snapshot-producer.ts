import { z } from 'zod'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import {
  TaskExecutionIdentity,
  TaskDigest,
  TaskLaunchOperationId,
  TaskOpaqueRef,
  TaskOwnerScopeSchema,
  TaskRefSchema,
  TaskEpoch
} from '../../shared/task-execution/task-execution-primitives'
import { TaskExecutionRecordSchema, type TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'

export const TaskCodeSnapshotProducerSchema = z.strictObject({
  ...TaskExecutionIdentity,
  task: TaskRefSchema,
  commandFingerprint: TaskDigest,
  operationId: TaskLaunchOperationId,
  operationCallerKey: TaskOpaqueRef,
  ownerScope: TaskOwnerScopeSchema,
  executionAccountRef: TaskOpaqueRef,
  workspaceRef: TaskOpaqueRef,
  executionWorkspaceId: z.string().min(1).max(512),
  workspaceExecutionClaimRef: TaskOpaqueRef,
  writeFence: TaskEpoch,
  sessionRef: z.string().min(1).max(160).nullable(),
  status: z.enum(['succeeded', 'failed']),
  outcomeRef: TaskOpaqueRef,
  resultDigest: TaskDigest
})
export type TaskCodeSnapshotProducer = z.infer<typeof TaskCodeSnapshotProducerSchema>

/** Only the original host store supplies this record; neither metadata nor a version reference grants access. */
export function taskCodeSnapshotProducer(record: TaskExecutionRecord): TaskCodeSnapshotProducer {
  const parsed = TaskExecutionRecordSchema.safeParse(record)
  if (!parsed.success) {
    refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const task = parsed.data,
    result = task.result
  if (
    !result ||
    (result.status !== 'succeeded' && result.status !== 'failed') ||
    task.dispatch !== 'bound' ||
    task.cancellationKey !== null ||
    result.stopProof.evidenceKind !== 'stopped' ||
    !result.stopProof.managedToolsSettled ||
    !result.stopProof.writersFenced
  ) {
    refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const command = task.command
  return TaskCodeSnapshotProducerSchema.parse({
    protocolVersion: command.protocolVersion,
    runtimeRecordId: command.runtimeRecordId,
    ownershipEpoch: command.ownershipEpoch,
    executionId: command.executionId,
    executionEpoch: command.executionEpoch,
    task: command.task,
    commandFingerprint: task.commandFingerprint,
    operationId: command.operationId,
    operationCallerKey: task.operationCallerKey,
    ownerScope: command.ownerScope,
    executionAccountRef: command.executionAccountRef,
    workspaceRef: command.workspaceRef,
    executionWorkspaceId: task.workspace.workspaceId,
    workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
    writeFence: command.writeFence,
    sessionRef:
      task.structuredBinding?.sessionId ??
      (task.launch?.outcome.kind === 'structured' ? task.launch.outcome.sessionId : null),
    status: result.status,
    outcomeRef: result.outcomeRef,
    resultDigest: canonicalAgentSessionDigest(result)
  })
}
