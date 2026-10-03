import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AgentInstallRequest } from '../../shared/agent-install-types'
import type { AgentInstallProvider } from '../../shared/agent-install-providers'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { hasReachedAppVersion } from '../../shared/app-version'
import { downloadAgentInstaller } from './agent-installer-download'
import { readAgentVersion } from './agent-version-service'
import { quoteAgentExecutable } from './agent-upgrade-target'
import { assertReviewedAgentTarget } from './agent-installation-identity'

export async function installAgentBinary(
  request: AgentInstallRequest,
  provider: Extract<AgentInstallProvider, { kind: 'binary' }>,
  activeCommand?: string,
  versions?: { previousVersion?: string; expectedVersion?: string | null }
): Promise<{ command: string; bin: string }> {
  const url = provider.urls[`${process.platform}-${process.arch}`]
  if (!url) {
    throw new Error('install-platform-unavailable')
  }
  const hostPath = process.platform === 'win32' ? path.win32 : path.posix
  const name = `${TUI_AGENT_CONFIG[request.agent].detectCmd}${process.platform === 'win32' ? '.exe' : ''}`
  const command =
    request.action === 'upgrade' ? activeCommand : hostPath.join(homedir(), '.local', 'bin', name)
  if (!command || hostPath.basename(command) !== name) {
    throw new Error('upgrade-provider-unavailable')
  }
  const bin = hostPath.dirname(command)
  const data = await downloadAgentInstaller(url, 128 * 1024 * 1024)
  mkdirSync(bin, { recursive: true })
  const candidate = hostPath.join(bin, `.hive-${randomUUID()}-${name}`)
  const backup = hostPath.join(bin, `.hive-backup-${randomUUID()}-${name}`)
  let backedUp = false
  let replaced = false
  try {
    writeFileSync(candidate, data, { mode: 0o755, flag: 'wx' })
    const candidateVersion = await readAgentVersion({
      agent: request.agent,
      commandOverride: quoteAgentExecutable(candidate)
    })
    if (
      candidateVersion.status !== 'ready' ||
      !candidateVersion.version ||
      (versions?.previousVersion &&
        !hasReachedAppVersion(candidateVersion.version, versions.previousVersion)) ||
      (versions?.expectedVersion &&
        !hasReachedAppVersion(candidateVersion.version, versions.expectedVersion))
    ) {
      throw new Error('install-verification-failed')
    }
    if (request.action === 'upgrade') {
      assertReviewedAgentTarget(request, command, process.env)
    }
    if (existsSync(command)) {
      renameSync(command, backup)
      backedUp = true
    }
    renameSync(candidate, command)
    replaced = true
    return { command, bin }
  } catch (error) {
    if (replaced) {
      rmSync(command, { force: true })
    }
    if (backedUp) {
      renameSync(backup, command)
    }
    throw error
  } finally {
    rmSync(candidate, { force: true })
    if (replaced && backedUp) {
      rmSync(backup, { force: true })
    }
  }
}
