import { toRuntimeExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import { restoreLocalStructuredSessionTabsOnce } from '../runtime/local-structured-session-tabs-sync'
import {
  collectTerminalProviderSnapshotPtyIds,
  refreshTerminalProviderSnapshotCapabilities
} from '../components/terminal/terminal-provider-snapshot-capability'
import { useAppStore } from '../store'
import { timeRendererStartupStep } from '../startup/startup-diagnostics'

type StartupTerminalActions = {
  reconnectPersistedTerminals: (signal: AbortSignal) => Promise<void>
}

export async function restoreStartupTerminalSession(
  actions: StartupTerminalActions,
  abortSignal: AbortSignal
): Promise<void> {
  await timeRendererStartupStep('recover-legacy-worker-terminals-pre-reconnect', () =>
    window.api.app.recoverLegacyWorkerTerminalsForRendererStartup()
  )
  await timeRendererStartupStep('terminal-provider-snapshot-capabilities', () =>
    refreshTerminalProviderSnapshotCapabilities(
      collectTerminalProviderSnapshotPtyIds(useAppStore.getState())
    )
  )
  await timeRendererStartupStep('reconnect-terminals', () =>
    actions.reconnectPersistedTerminals(abortSignal)
  )
  await timeRendererStartupStep('recover-legacy-worker-terminals-post-reconnect', () =>
    window.api.app.recoverLegacyWorkerTerminalsForRendererStartup()
  )
  if (useAppStore.getState().settings?.experimentalStructuredNativeChat === true) {
    await timeRendererStartupStep('project-structured-session-tabs', () =>
      restoreLocalStructuredSessionTabsOnce()
    )
  }
}

export async function listRuntimeSessionHostIdsForStartup(): Promise<ExecutionHostId[]> {
  try {
    return (await window.api.runtimeEnvironments.list()).map((environment) =>
      toRuntimeExecutionHostId(environment.id)
    )
  } catch (err) {
    console.warn('Failed to list runtime session hosts for startup:', err)
    return []
  }
}
