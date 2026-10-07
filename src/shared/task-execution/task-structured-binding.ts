import { z } from 'zod'
import {
  TaskDigest,
  TaskEpoch,
  TaskLaunchOperationId,
  TaskOpaqueRef
} from './task-execution-primitives'
import type { TaskExecutionStart } from './task-execution-command'

export const TaskSessionSourceReferenceSchema = z.strictObject({
  kind: z.literal('task_execution'),
  runtimeRecordId: TaskOpaqueRef,
  ownershipEpoch: TaskEpoch,
  executionId: TaskOpaqueRef,
  executionEpoch: TaskEpoch,
  commandFingerprint: TaskDigest
})
export type TaskSessionSourceReference = z.infer<typeof TaskSessionSourceReferenceSchema>

// Durable observations only; neither a source reference nor a binding grants authority.
export const TaskStructuredBindingSchema = z.strictObject({
  source: TaskSessionSourceReferenceSchema,
  operationCallerKey: TaskOpaqueRef,
  operationId: TaskLaunchOperationId,
  launchFingerprint: TaskDigest,
  attachOperationId: TaskLaunchOperationId,
  attachFingerprint: TaskDigest,
  sessionId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+(?![\s\S])/),
  runtimeFence: TaskEpoch,
  spawnToken: z.string().min(1).max(512),
  accountHome: z.strictObject({
    variable: z.literal('CODEX_HOME'),
    path: z.string().min(1).max(4096)
  }),
  location: z.strictObject({
    executionHostId: z.literal('local'),
    wslDistro: z.null(),
    workspaceId: z.string().min(1).max(512),
    workspaceKind: z.enum(['folder', 'git-worktree'])
  })
})
export type TaskStructuredBinding = z.infer<typeof TaskStructuredBindingSchema>

export function taskSessionSourceReference(record: {
  command: Pick<
    TaskExecutionStart,
    'runtimeRecordId' | 'ownershipEpoch' | 'executionId' | 'executionEpoch'
  >
  commandFingerprint: string
}): TaskSessionSourceReference {
  const { runtimeRecordId, ownershipEpoch, executionId, executionEpoch } = record.command
  return TaskSessionSourceReferenceSchema.parse({
    kind: 'task_execution',
    runtimeRecordId,
    ownershipEpoch,
    executionId,
    executionEpoch,
    commandFingerprint: record.commandFingerprint
  })
}
