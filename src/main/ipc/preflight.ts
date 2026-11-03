import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import {
  detectRemoteWindowsTerminalCapabilities,
  runPreflightCheck
} from '../preflight/agent-detection'
import {
  assertAgentDetectionHostRunning,
  detectAgentsOnHost,
  refreshAgentsOnHost,
  type AgentDetectionHost
} from '../preflight/workspace-agent-detection'
import type {
  PreflightRuntimeContext,
  PreflightStatus,
  RemoteWindowsTerminalCapabilities
} from '../preflight/agent-detection'

import { readZCodeInteractiveCapability } from '../zcode/interactive-capability'
import { getPreflightWslTarget } from './preflight-runtime-target'
import { runAsWslExecUserAct } from '../wsl/wsl-background-exec-gate'
import { deferRefusedPreflight } from './preflight-wsl-refusal-retry'
import { readAgentInstallations } from '../preflight/agent-installations-service'
import { installAgent } from '../preflight/agent-install-service'
import { readAgentVersion, readLatestAgentVersion } from '../preflight/agent-version-service'
import {
  PreflightInstallAgent,
  PreflightReadAgentVersion,
  PreflightReadLatestAgentVersion
} from '../../shared/rpc-contract/preflight-params'

type AgentDetectionRequest = PreflightRuntimeContext & { enabledOnly?: boolean }
/** Set by a user act (window focus, a click, opening a picker): it may start its WSL distro. */
type PreflightWake = { wakeWslDistro?: boolean }

function runPreflightAct<T>(
  context: (PreflightRuntimeContext & PreflightWake) | undefined,
  act: () => Promise<T>
): Promise<T> {
  const wslTarget = context?.wakeWslDistro ? getPreflightWslTarget(context) : null
  return deferRefusedPreflight(() =>
    wslTarget ? runAsWslExecUserAct(wslTarget.distro, act) : act()
  )
}

export function registerPreflightHandlers(store?: Pick<Store, 'getSettings'>): void {
  ipcMain.handle('preflight:readAgentInstallations', async (_event, args: unknown) => {
    return readAgentInstallations(PreflightReadAgentVersion.parse(args))
  })
  ipcMain.handle('preflight:installAgent', async (_event, args: unknown) => {
    return installAgent(PreflightInstallAgent.parse(args))
  })
  ipcMain.handle('preflight:readAgentVersion', async (_event, args: unknown) => {
    return readAgentVersion(PreflightReadAgentVersion.parse(args))
  })
  ipcMain.handle('preflight:readLatestAgentVersion', async (_event, args: unknown) => {
    return readLatestAgentVersion(PreflightReadLatestAgentVersion.parse(args))
  })
  const detectionOptions = (args?: AgentDetectionRequest) => {
    if (!args?.enabledOnly) {
      return undefined
    }
    if (!store) {
      throw new Error('Agent detection settings unavailable')
    }
    return { disabledTuiAgents: store.getSettings().disabledTuiAgents }
  }
  ipcMain.handle(
    'preflight:check',
    async (
      _event,
      args?: PreflightRuntimeContext & PreflightWake & { force?: boolean }
    ): Promise<PreflightStatus> => {
      return runPreflightAct(args, () => runPreflightCheck(args?.force, args))
    }
  )

  // Mount-time detection must not start a stopped distro; opening an agent picker wakes it.
  ipcMain.handle(
    'preflight:detectAgents',
    async (_event, args?: AgentDetectionRequest & PreflightWake) =>
      runPreflightAct(args, async () => {
        const host: AgentDetectionHost = { kind: 'local', context: args }
        await assertAgentDetectionHostRunning(host)
        return detectAgentsOnHost(host, detectionOptions(args))
      })
  )

  ipcMain.handle('preflight:zcodeInteractiveCapability', async () =>
    readZCodeInteractiveCapability()
  )

  ipcMain.handle(
    'preflight:refreshAgents',
    async (_event, args?: AgentDetectionRequest & PreflightWake) =>
      runPreflightAct(args, async () => {
        const host: AgentDetectionHost = { kind: 'local', context: args }
        await assertAgentDetectionHostRunning(host)
        return refreshAgentsOnHost(host, detectionOptions(args))
      })
  )

  ipcMain.handle(
    'preflight:detectRemoteAgents',
    async (_event, args: { connectionId: string }): Promise<string[]> =>
      detectAgentsOnHost({ kind: 'ssh', connectionId: args.connectionId })
  )

  ipcMain.handle(
    'preflight:detectRemoteWindowsTerminalCapabilities',
    async (_event, args: { connectionId: string }): Promise<RemoteWindowsTerminalCapabilities> => {
      return detectRemoteWindowsTerminalCapabilities(args)
    }
  )
}
