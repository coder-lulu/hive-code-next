import type { StructuredAgentSessionRuntimeDeps } from './structured-agent-session-runtime'
import type { AgentSessionRecordStore } from './agent-session-record-store'
import { createTaskCodexStructuredLaunchResolver } from '../tasks/task-codex-structured-launch'
import { readTaskDockerRuntimeConfiguration } from '../tasks/task-docker-runtime-configuration'
import { createTaskDockerSessionOwner } from '../tasks/task-docker-session-owner'
import {
  createStructuredAgentSessionOwnerProbe,
  createStructuredAgentSessionOwnerProbes
} from './structured-agent-session-owner-probe'

/** Shares the installed host's original Task/Session store and source-aware owner lifecycle. */
export function createStructuredTaskCodexRuntime(
  deps: StructuredAgentSessionRuntimeDeps,
  store: AgentSessionRecordStore
) {
  const ports = deps.taskDocker
  const owner = createTaskDockerSessionOwner({ store, run: ports?.runDocker })
  const probeOwner = createStructuredAgentSessionOwnerProbe(
    deps.hostId,
    undefined,
    undefined,
    owner
  )
  return {
    resolveLaunch: createTaskCodexStructuredLaunchResolver({
      store,
      resolveWorkspacePath: deps.resolveWorkspacePath,
      resolveAccountScope: (home) => {
        if (!deps.taskCodexAccounts) {
          throw new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
        }
        return deps.taskCodexAccounts.resolvePinned(home)
      },
      resolveDockerConfiguration:
        ports?.resolveDockerConfiguration ??
        (() => readTaskDockerRuntimeConfiguration(deps.stateDirectory)),
      subscribeAccounts: deps.taskCodexAccounts?.subscribe,
      runDocker: ports?.runDocker,
      openDocker: ports?.openDocker,
      readAuth: ports?.readAuth,
      request: ports?.request
    }),
    probeOwner,
    probeOwners: createStructuredAgentSessionOwnerProbes(deps.hostId, undefined, probeOwner, owner),
    stopExecutionOwner: owner.stop
  }
}
