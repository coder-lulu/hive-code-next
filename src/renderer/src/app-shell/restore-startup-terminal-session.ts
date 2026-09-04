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
  await timeRendererStartupStep('project-structured-session-tabs', () =>
    restoreLocalStructuredSessionTabsOnce()
  )
}
