import type {
  PreflightApi,
  PreflightStatus,
  RefreshAgentsResult
} from '../../../../preload/api-types'
import type {
  AgentVersionResult,
  LatestAgentVersionResult
} from '../../../../shared/agent-version-types'
import type { AgentInstallResult } from '../../../../shared/agent-install-types'
import type { AgentInstallationReport } from '../../../../shared/agent-installation-types'

type WebPreflightRuntime = {
  requireActiveEnvironmentOrNull: () => object | null
  callRuntimeResult: <TResult>(
    method: string,
    params?: unknown,
    timeoutMs?: number
  ) => Promise<TResult>
}

export function createPreflightApi({
  callRuntimeResult,
  requireActiveEnvironmentOrNull
}: WebPreflightRuntime): PreflightApi {
  const fallbackStatus: PreflightStatus = {
    git: { installed: false },
    gh: { installed: false, authenticated: false },
    glab: { installed: false, authenticated: false },
    bitbucket: { configured: false, authenticated: false, account: null },
    azureDevOps: {
      configured: false,
      authenticated: false,
      account: null,
      baseUrl: null,
      tokenConfigured: false
    },
    gitea: {
      configured: false,
      authenticated: false,
      account: null,
      baseUrl: null,
      tokenConfigured: false
    }
  }
  const fallbackRefreshAgents: RefreshAgentsResult = {
    agents: [],
    addedPathSegments: [],
    shellHydrationOk: false,
    pathSource: 'sync_seed_only',
    pathFailureReason: 'spawn_error'
  }
  type WindowsTerminalCapabilityBridgeResult = {
    wslAvailable: boolean
    wslDistros: string[]
    pwshAvailable: boolean
    gitBashAvailable: boolean
    hostPlatform: NodeJS.Platform | null
  }
  const fallbackWindowsTerminalCapabilities = {
    wslAvailable: false,
    wslDistros: [],
    pwshAvailable: false,
    gitBashAvailable: false,
    hostPlatform: null
  }
  return {
    readAgentInstallations: async (args) => {
      if (!requireActiveEnvironmentOrNull()) {
        return {
          status: 'error',
          installations: [],
          conflict: false,
          truncated: false,
          reason: 'environment-unverifiable'
        }
      }
      return callRuntimeResult<AgentInstallationReport>(
        'preflight.readAgentInstallations',
        args,
        120_000
      )
    },
    installAgent: async (args) => {
      if (!requireActiveEnvironmentOrNull()) {
        return { status: 'error', version: null, reason: 'environment-unverifiable' }
      }
      return callRuntimeResult<AgentInstallResult>('preflight.installAgent', args, 300_000)
    },
    check: async (args) => {
      if (!requireActiveEnvironmentOrNull()) {
        return fallbackStatus
      }
      return callRuntimeResult<PreflightStatus>('preflight.check', args)
    },
    // A paired client cannot probe the host's CLI installation locally.
    zcodeInteractiveCapability: async () => 'unknown' as const,
    detectAgents: async () => {
      if (!requireActiveEnvironmentOrNull()) {
        return []
      }
      return callRuntimeResult<string[]>('preflight.detectAgents').catch(() => [])
    },
    refreshAgents: () =>
      requireActiveEnvironmentOrNull()
        ? callRuntimeResult('preflight.refreshAgents')
            .then((result) => result as RefreshAgentsResult)
            .catch(() => fallbackRefreshAgents)
        : Promise.resolve(fallbackRefreshAgents),
    readAgentVersion: async (args) => {
      if (!requireActiveEnvironmentOrNull()) {
        return { status: 'error', version: null, reason: 'environment-unverifiable' }
      }
      return callRuntimeResult<AgentVersionResult>('preflight.readAgentVersion', args)
    },
    readLatestAgentVersion: async (args) => {
      if (!requireActiveEnvironmentOrNull()) {
        return {
          status: 'error',
          version: null,
          reason: 'environment-unverifiable',
          channel: 'npm-latest'
        }
      }
      return callRuntimeResult<LatestAgentVersionResult>('preflight.readLatestAgentVersion', args)
    },
    detectRemoteAgents: async (args) =>
      requireActiveEnvironmentOrNull()
        ? callRuntimeResult<string[]>('preflight.detectRemoteAgents', args).catch(() => [])
        : [],
    detectRemoteWindowsTerminalCapabilities: async (args) =>
      requireActiveEnvironmentOrNull()
        ? callRuntimeResult<WindowsTerminalCapabilityBridgeResult>(
            'preflight.detectRemoteWindowsTerminalCapabilities',
            args
          ).catch(() => fallbackWindowsTerminalCapabilities)
        : Promise.resolve(fallbackWindowsTerminalCapabilities)
  }
}
