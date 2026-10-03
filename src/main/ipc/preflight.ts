import { ipcMain } from 'electron'
import { readAgentInstallations } from '../preflight/agent-installations-service'
import { installAgent } from '../preflight/agent-install-service'
import { readAgentVersion, readLatestAgentVersion } from '../preflight/agent-version-service'
import {
  PreflightReadAgentVersion,
  PreflightInstallAgent,
  PreflightReadLatestAgentVersion
} from '../../shared/rpc-contract/preflight-params'
import {
  detectInstalledAgentsWithShellPathHydration,
  detectRemoteAgents,
  detectRemoteWindowsTerminalCapabilities,
  refreshShellPathAndDetectAgents,
  runPreflightCheck
} from '../preflight/agent-detection'
import type {
  PreflightRuntimeContext,
  PreflightStatus,
  RemoteWindowsTerminalCapabilities
} from '../preflight/agent-detection'

// Why this file is thin: everything above the handler layer moved to
// ../preflight/agent-detection so the runtime can call it without ipcMain.
// Re-exported here so existing importers of `ipc/preflight` keep working.
export * from '../preflight/agent-detection'
import { readZCodeInteractiveCapability } from '../zcode/interactive-capability'

export function registerPreflightHandlers(): void {
  ipcMain.handle('preflight:readAgentInstallations', async (_event, args: unknown) =>
    readAgentInstallations(PreflightReadAgentVersion.parse(args))
  )
  ipcMain.handle('preflight:installAgent', async (_event, args: unknown) =>
    installAgent(PreflightInstallAgent.parse(args))
  )
  ipcMain.handle(
    'preflight:check',
    async (
      _event,
      args?: PreflightRuntimeContext & { force?: boolean }
    ): Promise<PreflightStatus> => {
      return runPreflightCheck(args?.force, args)
    }
  )

  ipcMain.handle('preflight:detectAgents', async (_event, args?: PreflightRuntimeContext) =>
    detectInstalledAgentsWithShellPathHydration(args)
  )

  // Why here: this is the one place that already answers "what can the installed agent CLIs
  // do", and the probe is cached, so a repeat launch costs nothing.
  ipcMain.handle('preflight:zcodeInteractiveCapability', async () =>
    readZCodeInteractiveCapability()
  )

  ipcMain.handle('preflight:refreshAgents', async (_event, args?: PreflightRuntimeContext) => {
    return refreshShellPathAndDetectAgents(args)
  })

  ipcMain.handle('preflight:readAgentVersion', async (_event, args: unknown) =>
    readAgentVersion(PreflightReadAgentVersion.parse(args))
  )
  ipcMain.handle('preflight:readLatestAgentVersion', async (_event, args: unknown) =>
    readLatestAgentVersion(PreflightReadLatestAgentVersion.parse(args))
  )

  // Why: remote worktrees need agent detection on the SSH host, not the local
  // machine. This handler forwards the same KNOWN_AGENT_COMMANDS list to the
  // relay's preflight.detectAgents RPC, whose lookup command is selected on
  // the remote host so native Windows OpenSSH does not require a POSIX shell.
  ipcMain.handle(
    'preflight:detectRemoteAgents',
    async (_event, args: { connectionId: string }): Promise<string[]> => {
      return detectRemoteAgents(args)
    }
  )

  ipcMain.handle(
    'preflight:detectRemoteWindowsTerminalCapabilities',
    async (_event, args: { connectionId: string }): Promise<RemoteWindowsTerminalCapabilities> => {
      return detectRemoteWindowsTerminalCapabilities(args)
    }
  )
}
