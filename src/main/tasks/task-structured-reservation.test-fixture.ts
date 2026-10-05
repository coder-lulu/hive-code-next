import { vi } from 'vitest'
import {
  computeAgentLaunchFingerprint,
  deriveAgentLaunchChildOperationId
} from '../../shared/agent-launch-operation'
import {
  agentSessionOperationKey,
  pendingAgentSessionOperationRow
} from '../../shared/agent-session-operation-ledger'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import { taskSessionSourceReference } from '../../shared/task-execution/task-structured-binding'
import type { AgentSessionReserveRequest } from '../runtime/agent-session-reservation-admission'
import { emptyState } from '../runtime/agent-session-store-parsing'
import { admitTaskExecution } from './task-execution-admission'
import {
  TaskExecutionRecordSchema,
  taskExecutionRecordKey,
  type TaskExecutionWorkspace
} from './task-execution-record'
import type { TaskStructuredLaunchOrigin } from './task-structured-launch-origin'
import { taskCommand, taskWorkspace, TASK_TEST_NOW } from './task-execution.test-fixture'
import type { TaskExecutionStart } from '../../shared/task-execution/task-execution-command'

export const TASK_STRUCTURED_LOGS = 'logs/paperclip-development/p3/task-session-binding/writer'

export function taskStructuredFixture(
  workspace: TaskExecutionWorkspace = taskWorkspace('isolated-test'),
  taskReference?: TaskExecutionStart['task']
) {
  const state = emptyState('local')
  const validate = vi.fn(() => undefined)
  const command = taskCommand({
    operationId: `${TASK_TEST_NOW}-${'b'.repeat(32)}`,
    ...(taskReference ? { task: taskReference } : {})
  })
  const admission = {
    command,
    workspace,
    operationCallerKey: 'acct-runtime:local:test',
    now: TASK_TEST_NOW,
    validate
  }
  const accepted = admitTaskExecution(state, admission).record
  const task = TaskExecutionRecordSchema.parse({
    ...accepted,
    dispatch: 'dispatching',
    revision: 2
  })
  const key = taskExecutionRecordKey(command)
  state.taskExecutions!.set(key, task)
  const origin: TaskStructuredLaunchOrigin = {
    source: taskSessionSourceReference(task),
    operationCallerKey: task.operationCallerKey,
    operationId: command.operationId,
    launchFingerprint: computeAgentLaunchFingerprint({
      agent: 'codex',
      target: { kind: 'existing', worktree: workspace.workspaceId }
    }),
    validate,
    dispatch: {
      prepare: vi.fn(async () => undefined),
      assertCurrent: vi.fn(() => undefined)
    }
  }
  const outer = {
    ...pendingAgentSessionOperationRow({
      callerKey: origin.operationCallerKey,
      operationId: origin.operationId,
      fingerprint: origin.launchFingerprint,
      now: TASK_TEST_NOW
    }),
    outcome: { status: 'unknown' as const }
  }
  state.operations.set(agentSessionOperationKey(outer.callerKey, outer.operationId), outer)
  const operation = {
    callerKey: origin.operationCallerKey,
    operationId: deriveAgentLaunchChildOperationId(origin.operationId)!,
    fingerprint: canonicalAgentSessionDigest({
      method: 'agentSession.attach',
      sessionId: 'session-task-one'
    })
  }
  const inner = pendingAgentSessionOperationRow({ ...operation, now: TASK_TEST_NOW })
  const request: AgentSessionReserveRequest = {
    sessionId: 'session-task-one',
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: workspace.workspaceId,
      workspaceKind: workspace.isolation === 'managed_worktree' ? 'git-worktree' : 'folder'
    },
    provider: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: '/managed/test-codex-home' },
    expectedFence: null,
    spawnToken: 'task-spawn-one',
    claimKeyId: 'claim-key-one',
    handoffOperationId: operation.operationId,
    probe: { outcome: 'indeterminate', reason: 'no owner yet' },
    operation,
    now: TASK_TEST_NOW,
    taskOrigin: origin
  }
  validate.mockClear()
  return { state, command, admission, task, key, origin, request, outer, inner, validate }
}
