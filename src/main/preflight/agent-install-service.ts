import { withAgentNpmRegistry } from '../../shared/agent-npm-registry'
import {
  AGENT_INSTALL_PROVIDERS,
  type AgentInstallProvider
} from '../../shared/agent-install-providers'
import {
  NPM_AGENT_PACKAGES,
  type AgentInstallRequest,
  type AgentInstallResult
} from '../../shared/agent-install-types'
import { stripAnsiEscapeSequences } from '../../shared/ansi-escape-sequences'
import { PreflightInstallAgent } from '../../shared/rpc-contract/preflight-params'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { hydrateShellPathForAgentDetection } from '../ipc/agent-detection-shell-path'
import { buildLocalPreflightEnv } from '../ipc/preflight-local-env'
import { agentExecutable, resolveAgentUpgradeTarget } from './agent-upgrade-target'
import { installNpmAgent } from './agent-npm-install'
import { installManagedAgent } from './agent-managed-install'
import { resolveCliCommands } from '../../shared/node-cli-command-resolution'
import path from 'node:path'
import { agentInstallationRealPath, assertReviewedAgentTarget } from './agent-installation-identity'
import { isHomebrewManagedPath, resolveAgentHomebrewTarget } from './agent-homebrew-target'
import { upgradeHomebrewAgent } from './agent-homebrew-upgrade'

const pending = new Map<string, Promise<AgentInstallResult>>()
const hostQueues = new Map<string, Promise<unknown>>()
const failed = (reason: string, output?: string): AgentInstallResult => ({
  status: 'error',
  version: null,
  reason,
  ...(output ? { output: stripAnsiEscapeSequences(output).slice(-4096) } : {})
})

async function performProviderInstall(
  request: AgentInstallRequest,
  provider: AgentInstallProvider,
  packageName?: string
): Promise<AgentInstallResult> {
  if (request.action === 'upgrade' && !request.wslDistro) {
    await hydrateShellPathForAgentDetection()
    const env = buildLocalPreflightEnv() ?? process.env
    const executable = agentExecutable(request)
    const hostPath = process.platform === 'win32' ? path.win32 : path.posix
    const command =
      executable &&
      (hostPath.isAbsolute(executable)
        ? executable
        : resolveCliCommands([executable], { pathEnv: env.PATH ?? env.Path }).get(executable))
    if (!command) {
      return failed('upgrade-target-unverifiable')
    }
    assertReviewedAgentTarget(request, command, env)
    const homebrew = resolveAgentHomebrewTarget(request.agent, command)
    if (homebrew) {
      return upgradeHomebrewAgent(request, command, homebrew, env)
    }
    if (
      process.platform !== 'win32' &&
      isHomebrewManagedPath(agentInstallationRealPath(command, env))
    ) {
      return failed('upgrade-provider-unavailable')
    }
  }
  if (provider.kind === 'npm' && packageName) {
    return installNpmAgent(request, packageName)
  }
  if (provider.kind === 'bun' && request.action === 'upgrade' && packageName) {
    await hydrateShellPathForAgentDetection()
    const env = withAgentNpmRegistry(buildLocalPreflightEnv() ?? process.env, request.registry)
    if (request.wslDistro || resolveAgentUpgradeTarget(request, packageName, env)?.prefix) {
      return installNpmAgent(request, packageName)
    }
  }
  return installManagedAgent(request, provider)
}

export function installAgent(request: AgentInstallRequest): Promise<AgentInstallResult> {
  const parsed = PreflightInstallAgent.safeParse(request)
  if (!parsed.success) {
    return Promise.resolve(failed('invalid-install-request'))
  }
  const packageName = Object.hasOwn(NPM_AGENT_PACKAGES, parsed.data.agent)
    ? NPM_AGENT_PACKAGES[parsed.data.agent]
    : undefined
  const provider = Object.hasOwn(AGENT_INSTALL_PROVIDERS, parsed.data.agent)
    ? AGENT_INSTALL_PROVIDERS[parsed.data.agent]
    : undefined
  const runtime = parsed.data.wslDistro ? 'wsl' : process.platform
  if (
    !provider ||
    (parsed.data.wslDistro && process.platform !== 'win32') ||
    TUI_AGENT_CONFIG[parsed.data.agent].detectUnsupportedRuntimes?.includes(runtime)
  ) {
    return Promise.resolve({
      status: 'unsupported',
      version: null,
      reason: !provider ? 'install-provider-unavailable' : 'install-platform-unavailable'
    })
  }
  if (provider.kind === 'dependency') {
    return installAgent({ ...parsed.data, agent: provider.agent })
  }
  const host = JSON.stringify([
    parsed.data.wslDistro ? 'wsl' : 'native',
    parsed.data.wslDistro ?? null
  ])
  const key = JSON.stringify([
    host,
    parsed.data.agent,
    parsed.data.action,
    parsed.data.registry,
    parsed.data.commandOverride ?? '',
    parsed.data.expectedRealPath ?? ''
  ])
  const existing = pending.get(key)
  if (existing) {
    return existing
  }
  if (hostQueues.has(host)) {
    return Promise.resolve(failed('install-busy'))
  }
  // Global package managers share files; keep one bounded operation per host.
  const operation = Promise.resolve()
    .then(() => performProviderInstall(parsed.data, provider, packageName))
    .then((result) =>
      result.status === 'installed' && parsed.data.expectedRealPath
        ? { ...result, command: parsed.data.commandOverride }
        : result
    )
    .catch((error: unknown) =>
      failed(
        error instanceof Error && error.message === 'upgrade-target-changed'
          ? error.message
          : 'install-failed'
      )
    )
    .finally(() => {
      pending.delete(key)
      if (hostQueues.get(host) === operation) {
        hostQueues.delete(host)
      }
    })
  pending.set(key, operation)
  hostQueues.set(host, operation)
  return operation
}
