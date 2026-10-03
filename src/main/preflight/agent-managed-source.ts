import path from 'node:path'
import { AGENT_INSTALL_PROVIDERS } from '../../shared/agent-install-providers'
import type {
  AgentInstallationRequest,
  AgentInstallationSource
} from '../../shared/agent-installation-types'
import { resolveCliCommands } from '../../shared/node-cli-command-resolution'
import { runProcess } from '../../shared/child-process/run-process'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { verifyAgentBunOwnership } from './agent-upgrade-target'
import { sameAgentInstallationPath } from './agent-installation-identity'

export async function readManagedAgentSource(
  request: AgentInstallationRequest,
  command: string,
  env: NodeJS.ProcessEnv
): Promise<AgentInstallationSource> {
  const provider = AGENT_INSTALL_PROVIDERS[request.agent]
  const hostPath = process.platform === 'win32' ? path.win32 : path.posix
  if (provider?.kind === 'binary') {
    const name = `${TUI_AGENT_CONFIG[request.agent].detectCmd}${process.platform === 'win32' ? '.exe' : ''}`
    return hostPath.basename(command) === name ? 'binary' : 'unknown'
  }
  if (provider?.kind !== 'uv' && provider?.kind !== 'bun') {
    return 'unknown'
  }
  const manager = resolveCliCommands([provider.kind], { pathEnv: env.PATH ?? env.Path }).get(
    provider.kind
  )
  if (!manager || !hostPath.isAbsolute(manager)) {
    return 'unknown'
  }
  const directory = await runProcess({
    program: manager,
    args: provider.kind === 'uv' ? ['tool', 'dir', '--bin'] : ['pm', 'bin', '--global'],
    env,
    timeoutMs: 5000,
    maxOutputBytes: 4096
  })
  const bin = directory.stdout.trim()
  if (
    directory.code !== 0 ||
    directory.timedOut ||
    directory.outputTruncated ||
    !hostPath.isAbsolute(bin) ||
    !sameAgentInstallationPath(hostPath.dirname(command), bin)
  ) {
    return 'unknown'
  }
  if (provider.kind === 'bun' && !(await verifyAgentBunOwnership(request, command, manager, env))) {
    return 'unknown'
  }
  return provider.kind
}
