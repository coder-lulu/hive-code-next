import { relative, isAbsolute, sep } from 'node:path'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import { TaskExecutionStartSchema } from '../../shared/task-execution/task-execution-command'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import { refuseTaskExecution } from './task-execution-error'
import {
  TaskExecutionRecordSchema,
  TaskExecutionWorkspaceSchema,
  taskExecutionIdentity,
  taskExecutionRecordKey,
  type TaskExecutionRecord,
  type TaskExecutionWorkspace
} from './task-execution-record'

export const TASK_EXECUTION_RECORD_LIMIT = 4096

function pathsOverlap(first: string, second: string): boolean {
  const path = relative(first, second)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

export type TaskExecutionAdmission = {
  command: TaskExecutionRecord['command']
  operationCallerKey: string
  workspace: TaskExecutionWorkspace
  now: number
  validate: () => void
}

export function admitTaskExecution(state: AgentSessionStoreState, input: TaskExecutionAdmission) {
  input.validate()
  if (state.taskRecoveryBlocked) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const command = TaskExecutionStartSchema.parse(input.command)
  const workspace = TaskExecutionWorkspaceSchema.parse(input.workspace)
  const fingerprint = computeTaskExecutionFingerprint(command, input.operationCallerKey)
  const records = state.taskExecutions ?? new Map<string, TaskExecutionRecord>()
  const key = taskExecutionRecordKey(command)
  const current = records.get(key)
  if (current) {
    if (
      current.operationCallerKey !== input.operationCallerKey ||
      current.commandFingerprint !== fingerprint ||
      JSON.stringify(current.workspace) !== JSON.stringify(workspace)
    ) {
      return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
    }
    return { created: false, record: structuredClone(current) }
  }
  for (const record of records.values()) {
    if (
      (record.command.task.spaceId === command.task.spaceId &&
        record.command.task.runId === command.task.runId) ||
      (record.operationCallerKey === input.operationCallerKey &&
        (record.command.idempotencyKey === command.idempotencyKey ||
          record.command.operationId === command.operationId)) ||
      record.command.workspaceExecutionClaimRef === command.workspaceExecutionClaimRef
    ) {
      return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
    }
    if (record.result) {
      continue
    }
    if (
      record.command.task.spaceId === command.task.spaceId &&
      record.command.task.taskId === command.task.taskId
    ) {
      return refuseTaskExecution('TASK_BUSY')
    }
    if (
      pathsOverlap(record.workspace.executionPath, workspace.executionPath) ||
      pathsOverlap(workspace.executionPath, record.workspace.executionPath)
    ) {
      return refuseTaskExecution('WORKSPACE_BUSY')
    }
  }
  if (records.size >= TASK_EXECUTION_RECORD_LIMIT) {
    return refuseTaskExecution('CAPACITY_EXCEEDED')
  }
  const recordedAt = new Date(input.now).toISOString()
  const identity = {
    ...taskExecutionIdentity(command),
    commandFingerprint: fingerprint,
    recordedAt
  }
  const record = TaskExecutionRecordSchema.parse({
    command,
    operationCallerKey: input.operationCallerKey,
    commandFingerprint: fingerprint,
    revision: 1,
    workspace,
    status: 'accepted',
    dispatch: 'not_dispatched',
    launch: null,
    cancellationKey: null,
    accepted: {
      ...identity,
      kind: 'execution.accepted',
      receiptId: `accepted:${fingerprint}`,
      status: 'accepted',
      operationId: command.operationId,
      workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
      writeFence: command.writeFence
    },
    events: [
      {
        ...identity,
        kind: 'execution.event',
        eventId: `event:${fingerprint}:1`,
        sequence: 1,
        status: 'accepted',
        artifactRefs: []
      }
    ],
    result: null
  })
  state.taskExecutions = records
  records.set(key, record)
  return { created: true, record: structuredClone(record) }
}
