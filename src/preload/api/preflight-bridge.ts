import { ipcRenderer } from 'electron'
import type {
  AgentInstallationRequest,
  AgentInstallationReport
} from '../../shared/agent-installation-types'
import type { AgentInstallRequest, AgentInstallResult } from '../../shared/agent-install-types'
import type {
  AgentVersionRequest,
  AgentVersionResult,
  LatestAgentVersionRequest,
  LatestAgentVersionResult
} from '../../shared/agent-version-types'
import type { PreflightRuntimeContext, PreloadApi, RefreshAgentsResult } from '../api-types'
import type { ZCodeInteractiveCapability } from '../../shared/zcode-missing-tui'

export const preflightApi = {
  readAgentInstallations: (args: AgentInstallationRequest): Promise<AgentInstallationReport> =>
    ipcRenderer.invoke('preflight:readAgentInstallations', args),
  installAgent: (args: AgentInstallRequest): Promise<AgentInstallResult> =>
    ipcRenderer.invoke('preflight:installAgent', args),
  check: (args?: {
    force?: boolean
  }): Promise<{
    git: { installed: boolean }
    gh: { installed: boolean; authenticated: boolean }
    glab?: { installed: boolean; authenticated: boolean }
    bitbucket?: { configured: boolean; authenticated: boolean; account: string | null }
    azureDevOps?: {
      configured: boolean
      authenticated: boolean
      account: string | null
      baseUrl: string | null
      tokenConfigured: boolean
    }
    gitea?: {
      configured: boolean
      authenticated: boolean
      account: string | null
      baseUrl: string | null
      tokenConfigured: boolean
    }
    linear: { connected: boolean }
  }> => ipcRenderer.invoke('preflight:check', args),
  detectAgents: (args?: PreflightRuntimeContext): Promise<string[]> =>
    ipcRenderer.invoke('preflight:detectAgents', args),
  zcodeInteractiveCapability: (): Promise<ZCodeInteractiveCapability> =>
    ipcRenderer.invoke('preflight:zcodeInteractiveCapability'),
  refreshAgents: (args?: PreflightRuntimeContext): Promise<RefreshAgentsResult> =>
    ipcRenderer.invoke('preflight:refreshAgents', args),
  readAgentVersion: (args: AgentVersionRequest): Promise<AgentVersionResult> =>
    ipcRenderer.invoke('preflight:readAgentVersion', args),
  readLatestAgentVersion: (args: LatestAgentVersionRequest): Promise<LatestAgentVersionResult> =>
    ipcRenderer.invoke('preflight:readLatestAgentVersion', args),
  detectRemoteAgents: (args: { connectionId: string }): Promise<string[]> =>
    ipcRenderer.invoke('preflight:detectRemoteAgents', args),
  detectRemoteWindowsTerminalCapabilities: (args: {
    connectionId: string
  }): Promise<{
    wslAvailable: boolean
    wslDistros: string[]
    pwshAvailable: boolean
    gitBashAvailable: boolean
    hostPlatform: NodeJS.Platform | null
  }> => ipcRenderer.invoke('preflight:detectRemoteWindowsTerminalCapabilities', args)
} satisfies PreloadApi['preflight']
