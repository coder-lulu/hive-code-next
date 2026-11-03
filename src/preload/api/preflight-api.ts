import type { ZCodeInteractiveCapability } from '../../shared/zcode-missing-tui'
import type { AgentInstallationReport, AgentInstallationRequest } from '../../shared/agent-installation-types'
import type { AgentInstallRequest, AgentInstallResult } from '../../shared/agent-install-types'
import type { AgentVersionRequest, AgentVersionResult, LatestAgentVersionRequest, LatestAgentVersionResult } from '../../shared/agent-version-types'
import type { ProjectExecutionRuntimeResolution } from '../../shared/project-execution-runtime'
import type {
  PathSource,
  ShellHydrationFailureReason
} from '../../shared/shell-path-hydration-types'

export type PreflightStatus = {
  git: { installed: boolean }
  gh: { installed: boolean; authenticated: boolean }
  /** Absent on payloads predating GitLab support. */
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
}

export type RefreshAgentsResult = {
  agents: string[]
  addedPathSegments: string[]
  shellHydrationOk: boolean
  /** shell_hydrate uses the full shell PATH; sync_seed_only uses the packaged PATH seed. */
  pathSource: PathSource
  pathFailureReason: ShellHydrationFailureReason
}

export type PreflightRuntimeContext = {
  wslDistro?: string | null
  wslDefault?: boolean
  projectRuntime?: ProjectExecutionRuntimeResolution
}

export type PreflightApi = {
  readAgentInstallations: (args: AgentInstallationRequest) => Promise<AgentInstallationReport>
  installAgent: (args: AgentInstallRequest) => Promise<AgentInstallResult>
  readAgentVersion: (args: AgentVersionRequest) => Promise<AgentVersionResult>
  readLatestAgentVersion: (args: LatestAgentVersionRequest) => Promise<LatestAgentVersionResult>
  check: (
    args?: PreflightRuntimeContext & { force?: boolean; wakeWslDistro?: boolean }
  ) => Promise<PreflightStatus>
  /** Complete by default; background callers opt into host-owned enabled preferences. */
  detectAgents: (
    args?: PreflightRuntimeContext & { enabledOnly?: boolean; wakeWslDistro?: boolean }
  ) => Promise<string[]>
  /** A WSL distro a background check was refused for is running now; re-ask. Desktop only. */
  onWslDistroRunning?: (callback: (distro: string) => void) => () => void
  /** Cached in main for the process lifetime. */
  zcodeInteractiveCapability: () => Promise<ZCodeInteractiveCapability>
  /** `wakeWslDistro`: a user act that may start a stopped WSL distro; background refreshes omit it. */
  refreshAgents: (
    args?: PreflightRuntimeContext & { enabledOnly?: boolean; wakeWslDistro?: boolean }
  ) => Promise<RefreshAgentsResult>
  detectRemoteAgents: (args: { connectionId: string }) => Promise<string[]>
  detectRemoteWindowsTerminalCapabilities: (args: { connectionId: string }) => Promise<{
    wslAvailable: boolean
    wslDistros: string[]
    pwshAvailable: boolean
    gitBashAvailable: boolean
    hostPlatform: NodeJS.Platform | null
  }>
}
