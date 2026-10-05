import { isDeepStrictEqual as same } from 'node:util'
import { realpathSync } from 'node:fs'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { isAgentSessionRecord } from '../../shared/agent-session-record'
import {
  TaskSessionSourceReferenceSchema,
  TaskStructuredBindingSchema
} from '../../shared/task-execution/task-structured-binding'
import type {
  CodexStructuredLaunchInput,
  CodexStructuredLaunch
} from '../codex/codex-structured-session-state'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import type { runProcess } from '../../shared/child-process/run-process'
import type { openCodexAppServerConnection } from '../codex/codex-app-server-connection'
import type { getCodexBackendAuthHeaders } from '../rate-limits/codex-backend-auth'
import { CodexAppServerHandshakeExitUnprovenError } from '../codex/codex-app-server-handshake-exit-proof'
import type { TaskCodexAccountScope } from './task-codex-account-scope'
import type { TaskDockerRuntimeConfiguration } from './task-docker-runtime-configuration'
import { TaskExecutionRecordSchema } from './task-execution-record'
import { createTaskDockerBoundary } from './task-docker-boundary'
import { openTaskDockerCodexConnection } from './task-docker-codex-connection'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { taskLaunchPathKey } from './task-launch-workspace'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { createTaskCodexModelChannel } from './task-codex-model-channel'
import { refuseTaskExecution } from './task-execution-error'
import { taskExecutionDeadline } from './task-execution-budget'
import {
  prepareTaskDispatch,
  requireTaskDispatchAuthorization
} from './task-dispatch-authorization'
import { assertTaskCodexProcessCheckpoint } from './task-codex-process-checkpoint'

export type TaskCodexStructuredLaunchDependencies = {
  store: AgentSessionRecordStore
  resolveWorkspacePath: (workspaceId: string) => Promise<string>
  resolveAccountScope: (pinnedCodexHome: string) => TaskCodexAccountScope
  resolveDockerConfiguration: () => TaskDockerRuntimeConfiguration
  subscribeAccounts?: (listener: () => void) => () => void
  runDocker?: typeof runProcess
  openDocker?: typeof openCodexAppServerConnection
  readAuth?: typeof getCodexBackendAuthHeaders
  request?: typeof fetch
}

function requireOrigin(input: CodexStructuredLaunchInput) {
  const origin = input.taskOrigin
  if (
    !origin ||
    typeof origin.validate !== 'function' ||
    !input.spawnGuard ||
    typeof input.spawnGuard.prepare !== 'function' ||
    typeof input.spawnGuard.assertCurrent !== 'function'
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  assertTaskAuthorizationCurrent(() => origin.validate())
  const dispatch = requireTaskDispatchAuthorization(origin.dispatch)
  const source = TaskSessionSourceReferenceSchema.safeParse(origin.source)
  if (!source.success) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  return { origin: { ...origin, source: source.data }, guard: input.spawnGuard, dispatch }
}

/** Classifies the original source before resolving any native launch environment or credentials. */
export function createTaskCodexStructuredLaunchResolver(
  deps: TaskCodexStructuredLaunchDependencies
) {
  return async (
    input: CodexStructuredLaunchInput,
    record: AgentSessionRecord
  ): Promise<CodexStructuredLaunch> => {
    const { origin, guard, dispatch } = requireOrigin(input)
    const task = deps.store.tasks.get(origin.source)
    const parsed = TaskStructuredBindingSchema.safeParse(task?.structuredBinding)
    if (
      !task ||
      !TaskExecutionRecordSchema.safeParse(task).success ||
      !parsed.success ||
      !isAgentSessionRecord(record) ||
      !same(deps.store.getRecord(record.sessionId), record)
    ) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    const binding = parsed.data
    if (
      record.provider !== 'codex' ||
      !same(record.taskSource, binding.source) ||
      !same(origin.source, binding.source) ||
      origin.operationCallerKey !== binding.operationCallerKey ||
      origin.operationId !== binding.operationId ||
      origin.launchFingerprint !== binding.launchFingerprint ||
      input.identity.sessionId !== binding.sessionId ||
      input.identity.agent !== 'codex' ||
      input.identity.hostId !== binding.location.executionHostId ||
      input.identity.workspaceId !== binding.location.workspaceId ||
      input.fence !== binding.runtimeFence ||
      input.spawnToken !== binding.spawnToken
    ) {
      return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
    }
    if (
      task.status !== 'accepted' ||
      task.dispatch !== 'dispatching' ||
      Object.hasOwn(task, 'dockerIdentity') ||
      record.lease.ownerProcess !== null ||
      record.lease.claimStatus !== 'reserved' ||
      record.providerHandleChain.length !== 0
    ) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    const assertSource = () => {
      assertTaskAuthorizationCurrent(() => origin.validate())
      assertTaskAuthorizationCurrent(() => guard.assertCurrent())
      deps.store.tasks.assertStructuredBindingCurrent(binding)
    }
    assertSource()
    if ((await guard.prepare()) !== undefined) {
      return refuseTaskExecution('FORBIDDEN')
    }
    assertSource()
    const workspace = await deps.resolveWorkspacePath(binding.location.workspaceId)
    assertSource()
    if (
      taskLaunchPathKey(realpathSync(workspace)) !== taskLaunchPathKey(task.workspace.executionPath)
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const account = deps.resolveAccountScope(binding.accountHome.path)
    assertTaskAuthorizationCurrent(() => account.assertCurrent())
    if (account.codexHome !== binding.accountHome.path) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const configuration = deps.resolveDockerConfiguration()
    const assertCurrent = () => {
      assertSource()
      assertTaskAuthorizationCurrent(() => account.assertMetadataCurrent())
    }
    assertCurrent()
    let committedPid: number | undefined
    const assertModelCurrent = () => {
      assertCurrent()
      assertTaskCodexProcessCheckpoint(deps.store, binding, committedPid)
    }
    const modelChannel = createTaskCodexModelChannel({
      store: deps.store,
      binding,
      account,
      deadline: taskExecutionDeadline(task),
      assertCurrent: assertModelCurrent,
      readAuth: deps.readAuth,
      request: deps.request
    })
    const boundary = createTaskDockerBoundary({
      ...configuration,
      record: task,
      assertCurrent,
      dispatch,
      run: deps.runDocker,
      persistIdentity: async (identity) => {
        await prepareTaskDispatch(dispatch, assertCurrent)
        await deps.store.tasks.persistDockerIdentity(binding.source, identity, Date.now(), () => {
          assertCurrent()
          assertTaskAuthorizationCurrent(() => dispatch.assertCurrent())
        })
      }
    })
    const profile = taskDockerModelProfile()
    return {
      command: configuration.dockerPath,
      args: [],
      cwd: '/workspace',
      codexHome: null,
      resumeThreadId: null,
      model: profile.model,
      permissionPolicy: { approvalPolicy: 'never', sandbox: 'workspace-write' },
      openTaskConnection: async (handlers) => {
        let connection: Awaited<ReturnType<typeof openTaskDockerCodexConnection>> | undefined
        const unsubscribe = deps.subscribeAccounts?.(() => {
          try {
            assertCurrent()
          } catch {
            void modelChannel.close()
            void connection?.close().catch(() => undefined)
          }
        })
        try {
          connection = await openTaskDockerCodexConnection({
            boundary,
            dispatch,
            modelChannel,
            open: deps.openDocker,
            handlers: {
              ...handlers,
              onSpawned: async (pid) => {
                if (typeof handlers.onSpawned !== 'function') {
                  return refuseTaskExecution('OUTCOME_UNKNOWN')
                }
                await handlers.onSpawned(pid)
                assertCurrent()
                assertTaskCodexProcessCheckpoint(deps.store, binding, pid)
                committedPid = pid
              },
              onExit: (error) => {
                unsubscribe?.()
                handlers.onExit?.(error)
              }
            }
          })
          assertCurrent()
          const originalClose = connection.close
          connection.close = async () => {
            const stopped = await originalClose()
            if (stopped) {
              unsubscribe?.()
            }
            return stopped
          }
          return connection
        } catch (error) {
          unsubscribe?.()
          await modelChannel.close()
          if (connection && !(await connection.close().catch(() => false))) {
            throw new CodexAppServerHandshakeExitUnprovenError(connection, error)
          }
          throw error
        }
      }
    }
  }
}
