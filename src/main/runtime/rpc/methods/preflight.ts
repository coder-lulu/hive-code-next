import { defineMethod } from '../core'
import { readAgentInstallations } from '../../../preflight/agent-installations-service'
import { installAgent } from '../../../preflight/agent-install-service'
import { readAgentVersion, readLatestAgentVersion } from '../../../preflight/agent-version-service'
import {
  detectRemoteWindowsTerminalCapabilities,
  runPreflightCheck
} from '../../../preflight/agent-detection'
import {
  detectAgentsOnHost,
  refreshAgentsOnHost
} from '../../../preflight/workspace-agent-detection'
import {
  PreflightAgentDetection,
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
    permission: 'workspace',
    params: PreflightReadAgentVersion,
    handler: async (params) => readAgentInstallations(params)
  }),
  defineMethod({
    name: 'preflight.installAgent',
    permission: 'host-admin',
    params: PreflightInstallAgent,
    handler: async (params) => installAgent(params)
  }),
  defineMethod({
    name: 'preflight.check',
    permission: 'workspace',
    params: PreflightCheck,
    handler: async (params) => runPreflightCheck(params.force)
  }),
  defineMethod({
    name: 'preflight.detectAgents',
    permission: 'workspace',
    params: PreflightAgentDetection,
    // Why the host resolves: only it knows the workspace's project runtime, including WSL.
    handler: async (params, { runtime }) =>
      detectAgentsOnHost(await runtime.resolveAgentDetectionHost(params.worktreeId))
  }),
  defineMethod({
    name: 'preflight.detectRemoteAgents',
    permission: 'workspace',
    params: PreflightDetectRemoteAgents,
    handler: async (params) =>
      detectAgentsOnHost({ kind: 'ssh', connectionId: params.connectionId })
  }),
  defineMethod({
    name: 'preflight.detectRemoteWindowsTerminalCapabilities',
    permission: 'workspace',
    params: PreflightDetectRemoteWindowsTerminalCapabilities,
    handler: async (params) => detectRemoteWindowsTerminalCapabilities(params)
  }),
  defineMethod({
    name: 'preflight.refreshAgents',
    permission: 'workspace',
    params: PreflightAgentDetection,
    handler: async (params, { runtime }) =>
      refreshAgentsOnHost(await runtime.resolveAgentDetectionHost(params.worktreeId))
  }),
  defineMethod({
    name: 'preflight.readAgentVersion',
    permission: 'workspace',
    params: PreflightReadAgentVersion,
    handler: async (params) => readAgentVersion(params)
  }),
  defineMethod({
    name: 'preflight.readLatestAgentVersion',
    permission: 'workspace',
    params: PreflightReadLatestAgentVersion,
    handler: async (params) => readLatestAgentVersion(params)
  })
]
