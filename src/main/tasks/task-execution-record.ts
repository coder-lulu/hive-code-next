import { z } from 'zod'
import { isAgentLaunchResult, type AgentLaunchResult } from '../../shared/agent-launch-intent'
import { TaskExecutionStartSchema } from '../../shared/task-execution/task-execution-command'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import {
  TaskCounter,
  TaskDigest,
  TaskExecutionStatus,
  TaskOpaqueRef
} from '../../shared/task-execution/task-execution-primitives'
import {
  TaskExecutionAcceptedSchema,
  TaskExecutionEventSchema,
  TaskExecutionResultSchema
} from '../../shared/task-execution/task-execution-receipts'
import { TaskDockerIdentitySchema, taskDockerIdentityMatchesRecord } from './task-docker-identity'

export const TaskWorkspaceDirectoryIdentitySchema = z.strictObject({
  dev: z.string().max(40).regex(/^\d+$/),
  ino: z
    .string()
    .max(40)
    .regex(/^[1-9]\d*$/),
  birthtimeNs: z
    .string()
    .max(40)
    .regex(/^-?\d+$/)
})
export type TaskWorkspaceDirectoryIdentity = z.infer<typeof TaskWorkspaceDirectoryIdentitySchema>

export const TaskExecutionWorkspaceSchema = z.strictObject({
  hostId: z.literal('local'),
  workspaceId: z.string().min(1).max(512),
  canonicalPath: z.string().min(1).max(4096),
  executionPath: z.string().min(1).max(4096),
  isolation: z.enum(['managed_worktree', 'managed_copy']),
  // Missing original evidence remains readable but cannot authorize workspace recovery.
  directoryIdentity: TaskWorkspaceDirectoryIdentitySchema.optional()
})

export const TaskExecutionRecordSchema = z
  .strictObject({
    command: TaskExecutionStartSchema,
    operationCallerKey: TaskOpaqueRef,
    commandFingerprint: TaskDigest,
    revision: TaskCounter.min(1),
    workspace: TaskExecutionWorkspaceSchema,
    dockerIdentity: TaskDockerIdentitySchema.optional(),
    accepted: TaskExecutionAcceptedSchema,
    status: TaskExecutionStatus,
    dispatch: z.enum(['not_dispatched', 'dispatching', 'bound']),
    launch: z.custom<AgentLaunchResult>(isAgentLaunchResult).nullable(),
    cancellationKey: TaskOpaqueRef.nullable(),
    events: z.array(TaskExecutionEventSchema).min(1).max(4096),
    result: TaskExecutionResultSchema.nullable()
  })
  .superRefine((record, context) => {
    const fingerprint = computeTaskExecutionFingerprint(record.command, record.operationCallerKey)
    const receipts = [record.accepted, ...record.events, ...(record.result ? [record.result] : [])]
    if (
      fingerprint !== record.commandFingerprint ||
      (record.dockerIdentity && !taskDockerIdentityMatchesRecord(record.dockerIdentity, record)) ||
      record.accepted.operationId !== record.command.operationId ||
      record.accepted.workspaceExecutionClaimRef !== record.command.workspaceExecutionClaimRef ||
      record.accepted.writeFence !== record.command.writeFence ||
      (record.dispatch === 'bound') !== (record.launch !== null) ||
      (record.launch && record.launch.worktreeId !== record.workspace.workspaceId) ||
      (record.result !== null) !== ['succeeded', 'failed', 'cancelled'].includes(record.status) ||
      (record.result && record.result.status !== record.status) ||
      receipts.some(
        (receipt) =>
          receipt.executionId !== record.command.executionId ||
          receipt.executionEpoch !== record.command.executionEpoch ||
          receipt.runtimeRecordId !== record.command.runtimeRecordId ||
          receipt.ownershipEpoch !== record.command.ownershipEpoch ||
          receipt.commandFingerprint !== fingerprint
      ) ||
      record.events.some((event, index) => event.sequence !== index + 1) ||
      record.events.at(-1)?.status !== record.status
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid durable task execution binding.' })
    }
  })

export type TaskExecutionRecord = z.infer<typeof TaskExecutionRecordSchema>
export type TaskExecutionWorkspace = z.infer<typeof TaskExecutionWorkspaceSchema>

export function taskExecutionRecordKey(
  command: Pick<
    TaskExecutionRecord['command'],
    'runtimeRecordId' | 'executionId' | 'executionEpoch'
  >
): string {
  return JSON.stringify([command.runtimeRecordId, command.executionId, command.executionEpoch])
}

export function taskExecutionIdentity(command: TaskExecutionRecord['command']) {
  return {
    protocolVersion: command.protocolVersion,
    runtimeRecordId: command.runtimeRecordId,
    ownershipEpoch: command.ownershipEpoch,
    executionId: command.executionId,
    executionEpoch: command.executionEpoch
  }
}
