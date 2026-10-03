import type { ZCodeInteractiveCapability } from '../../shared/zcode-missing-tui'
import type { ProjectExecutionRuntimeResolution } from '../../shared/project-execution-runtime'
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
import type {
  PathSource,
  ShellHydrationFailureReason
} from '../../shared/shell-path-hydration-types'

export type PreflightStatus = {
  git: { installed: boolean }
  gh: { installed: boolean; authenticated: boolean }
  /** Optional — older preload payloads predating GitLab support omit it; consumers gate on `glab?.installed`. */
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
  /** Drives agent_picks `on_path:false` triage (dashboard 1562016). `'shell_hydrate'` = detection saw the user's
   *  full shell PATH; `'sync_seed_only'` = hydration failed and detection ran against the `patchPackagedProcessPath` seed list. */
  pathSource: PathSource
  /** Classified hydration outcome: `'none'` on success, else a failure mode when `shellHydrationOk` is false. */
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
  check: (args?: PreflightRuntimeContext & { force?: boolean }) => Promise<PreflightStatus>
  detectAgents: (args?: PreflightRuntimeContext) => Promise<string[]>
  /** Whether the installed `zcode` can open a session; cached in main per run. */
  zcodeInteractiveCapability: () => Promise<ZCodeInteractiveCapability>
  refreshAgents: (args?: PreflightRuntimeContext) => Promise<RefreshAgentsResult>
  readAgentVersion: (args: AgentVersionRequest) => Promise<AgentVersionResult>
  readLatestAgentVersion: (args: LatestAgentVersionRequest) => Promise<LatestAgentVersionResult>
  detectRemoteAgents: (args: { connectionId: string }) => Promise<string[]>
  detectRemoteWindowsTerminalCapabilities: (args: { connectionId: string }) => Promise<{
    wslAvailable: boolean
    wslDistros: string[]
    pwshAvailable: boolean
    gitBashAvailable: boolean
    hostPlatform: NodeJS.Platform | null
  }>
}
