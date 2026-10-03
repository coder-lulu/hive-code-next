import { defineMethod } from '../core'
import { readAgentInstallations } from '../../../preflight/agent-installations-service'
import { installAgent } from '../../../preflight/agent-install-service'
import { readAgentVersion, readLatestAgentVersion } from '../../../preflight/agent-version-service'
import {
  detectRemoteAgents,
  detectRemoteWindowsTerminalCapabilities,
  detectInstalledAgentsWithShellPathHydration,
  refreshShellPathAndDetectAgents,
  runPreflightCheck
} from '../../../preflight/agent-detection'
import {
  PreflightCheck,
  PreflightInstallAgent,
  PreflightDetectRemoteAgents,
  PreflightDetectRemoteWindowsTerminalCapabilities,
  PreflightReadAgentVersion,
  PreflightReadLatestAgentVersion
} from '../../../../shared/rpc-contract/preflight-params'

export const PREFLIGHT_METHODS = [
  defineMethod({
    name: 'preflight.readAgentInstallations',
    params: PreflightReadAgentVersion,
    handler: async (params) => readAgentInstallations(params)
  }),
  defineMethod({
    name: 'preflight.installAgent',
    params: PreflightInstallAgent,
    handler: async (params) => installAgent(params)
  }),
  defineMethod({
    name: 'preflight.check',
    params: PreflightCheck,
    handler: async (params) => runPreflightCheck(params.force)
  }),
  defineMethod({
    name: 'preflight.detectAgents',
    params: null,
    // HiveCode AI is bundled with this Host; it has no external CLI to probe.
    handler: async () => [
      ...new Set([...(await detectInstalledAgentsWithShellPathHydration()), 'hivecode'])
    ]
  }),
  defineMethod({
    name: 'preflight.detectRemoteAgents',
    params: PreflightDetectRemoteAgents,
    handler: async (params) => detectRemoteAgents(params)
  }),
  defineMethod({
    name: 'preflight.detectRemoteWindowsTerminalCapabilities',
    params: PreflightDetectRemoteWindowsTerminalCapabilities,
    handler: async (params) => detectRemoteWindowsTerminalCapabilities(params)
  }),
  defineMethod({
    name: 'preflight.refreshAgents',
    params: null,
    handler: async () => {
      const result = await refreshShellPathAndDetectAgents()
      return { ...result, agents: [...new Set([...result.agents, 'hivecode'])] }
    }
  }),
  defineMethod({
    name: 'preflight.readAgentVersion',
    params: PreflightReadAgentVersion,
    handler: async (params) => readAgentVersion(params)
  }),
  defineMethod({
    name: 'preflight.readLatestAgentVersion',
    params: PreflightReadLatestAgentVersion,
    handler: async (params) => readLatestAgentVersion(params)
  })
]
