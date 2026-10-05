import { AGENT_LAUNCH_METHODS } from '../runtime/rpc/methods/agent-launch'
import { agentLaunchOperationCallerKey } from '../runtime/rpc/methods/agent-launch-replay'
import type { RpcContext } from '../runtime/rpc/core'
import {
  AGENT_LAUNCH_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'
import type { TaskExecutionAuthorization } from './task-execution-host'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'
import { hasExplicitTuiLaunchCommand } from '../../shared/tui-agent-launch-command-override'
import { requireTaskLaunchWorkspace, taskLaunchPathKey } from './task-launch-workspace'
import { taskAgentLaunchParams } from './task-agent-launch-params'
import { computeAgentLaunchFingerprint } from '../../shared/agent-launch-operation'
import { taskSessionSourceReference } from '../../shared/task-execution/task-structured-binding'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import {
  prepareTaskDispatch,
  requireTaskDispatchAuthorization
} from './task-dispatch-authorization'

/** Uses the existing replay handler and ledger, including its unknown-outcome refusal. */
export function createTaskAgentLaunchPort(options: {
  context: () => RpcContext
  capabilities: () => readonly string[]
  executor?: 'hivecode' | 'codex'
}) {
  const executor = options.executor ?? 'hivecode'
  const method = AGENT_LAUNCH_METHODS.find((entry) => entry.name === 'agent.launchReplay')!
  return async (record: TaskExecutionRecord, authorization: TaskExecutionAuthorization) => {
    assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
    const dispatch =
      executor === 'codex' ? requireTaskDispatchAuthorization(authorization.dispatch) : undefined
    if (dispatch) {
      await prepareTaskDispatch(dispatch, () => authorization.assertCurrent())
    }
    const capabilities = options.capabilities()
    if (
      !capabilities.includes(AGENT_LAUNCH_RUNTIME_CAPABILITY) ||
      !capabilities.includes(AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY)
    ) {
      return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
    }
    const context = options.context()
    if (hasExplicitTuiLaunchCommand(context.runtime.getClientSettings(), executor)) {
      return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
    }
    if (agentLaunchOperationCallerKey(context) !== record.operationCallerKey) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const workspace = await requireTaskLaunchWorkspace(context, record.workspace)
    assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
    const params = taskAgentLaunchParams(
      { ...record, workspace: { ...record.workspace, executionPath: workspace.executionPath } },
      authorization.input,
      executor
    )
    const taskLaunchOrigin =
      executor === 'codex'
        ? {
            source: taskSessionSourceReference(record),
            operationCallerKey: record.operationCallerKey,
            operationId: record.command.operationId,
            launchFingerprint: computeAgentLaunchFingerprint(params),
            dispatch,
            validate: () => {
              assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
              if (hasExplicitTuiLaunchCommand(context.runtime.getClientSettings(), executor)) {
                return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
              }
            }
          }
        : undefined
    return method.handler(params, {
      ...context,
      ...(taskLaunchOrigin ? { taskLaunchOrigin } : {}),
      ...(executor === 'codex' ? { requiredAgentLaunchMode: 'structured' as const } : {}),
      assertAgentLaunchCurrent: (intent, spawnScope) => {
        assertTaskAuthorizationCurrent(() => context.assertAgentLaunchCurrent?.(intent, spawnScope))
        assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
        if (hasExplicitTuiLaunchCommand(context.runtime.getClientSettings(), executor)) {
          return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
        }
        if (
          intent.agent !== executor ||
          intent.target.kind !== 'existing' ||
          intent.target.connectionId !== null ||
          intent.target.worktree !== workspace.scope.id ||
          !intent.target.workspacePath ||
          taskLaunchPathKey(intent.target.workspacePath) !==
            taskLaunchPathKey(workspace.scope.path) ||
          intent.cwd !== workspace.executionPath
        ) {
          return refuseTaskExecution('FORBIDDEN')
        }
        if (
          spawnScope &&
          (spawnScope.worktreeId !== workspace.scope.id ||
            spawnScope.connectionId !== null ||
            !spawnScope.workspacePath ||
            taskLaunchPathKey(spawnScope.workspacePath) !==
              taskLaunchPathKey(workspace.scope.path) ||
            !spawnScope.cwd ||
            taskLaunchPathKey(spawnScope.cwd) !== taskLaunchPathKey(workspace.executionPath))
        ) {
          return refuseTaskExecution('FORBIDDEN')
        }
      }
    })
  }
}
