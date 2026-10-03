import { listCliCommandCandidates } from '../../shared/cli-command-candidates'
import path from 'node:path'
import { lstatSync } from 'node:fs'
import type {
  AgentInstallation,
  AgentInstallationReport,
  AgentInstallationRequest,
  AgentInstallationSource
} from '../../shared/agent-installation-types'
import { AGENT_INSTALL_PROVIDERS } from '../../shared/agent-install-providers'
import { NPM_AGENT_PACKAGES } from '../../shared/agent-install-types'
import { resolveCliCommands } from '../../shared/node-cli-command-resolution'
import { PreflightReadAgentVersion } from '../../shared/rpc-contract/preflight-params'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { hydrateShellPathForAgentDetection } from '../ipc/agent-detection-shell-path'
import { buildLocalPreflightEnv } from '../ipc/preflight-local-env'
import { getWslGuestEnvironment } from '../wsl/wsl-guest-environment'
import { runWslProcess } from '../wsl/wsl-runner'
import { readAgentVersion } from './agent-version-service'
import {
  agentExecutable,
  quoteAgentExecutable,
  resolveAgentUpgradeTarget
} from './agent-upgrade-target'
import { agentInstallationRealPath, sameAgentInstallationPath } from './agent-installation-identity'
import {
  homebrewTargetFromPath,
  isHomebrewManagedPath,
  readHomebrewTargetVersion
} from './agent-homebrew-target'
import { buildAgentInstallationsGuestScript } from './agent-installations-guest'
import { readManagedAgentSource } from './agent-managed-source'

type Candidate = Pick<AgentInstallation, 'path' | 'realPath' | 'source'>
const LIMIT = 12
const failure = (reason: string): AgentInstallationReport => ({
  status: 'error',
  installations: [],
  conflict: false,
  truncated: false,
  reason
})

async function localCandidates(request: AgentInstallationRequest) {
  await hydrateShellPathForAgentDetection()
  const env = buildLocalPreflightEnv() ?? process.env
  const pathEnv = env.PATH ?? env.Path
  const command = TUI_AGENT_CONFIG[request.agent].detectCmd
  const executable = agentExecutable(request)!
  const hostPath = process.platform === 'win32' ? path.win32 : path.posix
  const defaults = resolveCliCommands([command, executable], { pathEnv })
  const active = hostPath.isAbsolute(executable) ? executable : defaults.get(executable)
  const paths = [active, ...listCliCommandCandidates(command, { pathEnv })]
  const candidates: Candidate[] = []
  for (const file of new Set(paths)) {
    if (!file || !hostPath.isAbsolute(file)) {
      continue
    }
    try {
      candidates.push({
        path: file,
        realPath: agentInstallationRealPath(file, env),
        source: 'unknown'
      })
    } catch {
      try {
        if (lstatSync(file).isSymbolicLink()) {
          candidates.push({ path: file, realPath: file, source: 'unknown' })
        }
      } catch {
        // A removed directory entry is not an installation.
      }
    }
  }
  return { candidates, active, defaultPath: defaults.get(command), env }
}

async function guestCandidates(request: AgentInstallationRequest) {
  const guest = await getWslGuestEnvironment(request.wslDistro!)
  if (!guest) {
    throw new Error('environment-unverifiable')
  }
  const result = await runWslProcess({
    distro: request.wslDistro!,
    loginPath: 'none',
    script: buildAgentInstallationsGuestScript(request, guest),
    timeoutMs: 15_000,
    maxOutputBytes: 64 * 1024
  })
  if (
    result.code !== 0 ||
    result.timedOut ||
    result.outputTruncated ||
    !result.environmentResolved
  ) {
    throw new Error('environment-unverifiable')
  }
  const fields = result.stdout.split('\0')
  if (fields[0] !== '__HIVE_INSTALLATIONS__') {
    throw new Error('environment-unverifiable')
  }
  const candidates: Candidate[] = []
  for (let index = 3; index + 2 < fields.length; index += 3) {
    const [file, realPath, source] = fields.slice(index, index + 3)
    if (!path.posix.isAbsolute(file) || !path.posix.isAbsolute(realPath)) {
      continue
    }
    candidates.push({
      path: file,
      realPath,
      source:
        source === 'npm' ||
        source === 'self-update' ||
        source === 'bun' ||
        source === 'uv' ||
        source === 'binary'
          ? source
          : 'unknown'
    })
  }
  return { candidates, defaultPath: fields[1], active: fields[2], env: {} }
}

export async function readAgentInstallations(
  input: AgentInstallationRequest
): Promise<AgentInstallationReport> {
  const parsed = PreflightReadAgentVersion.safeParse(input)
  if (!parsed.success) {
    return failure('invalid-version-request')
  }
  const request =
    parsed.data.agent === 'claude-agent-teams'
      ? { ...parsed.data, agent: 'claude' as const }
      : parsed.data
  if (request.wslDistro && process.platform !== 'win32') {
    return failure('wsl-target-unavailable')
  }
  if (!agentExecutable(request)) {
    return failure('complex-command-override')
  }
  try {
    const { candidates, active, defaultPath, env } = request.wslDistro
      ? await guestCandidates(request)
      : await localCandidates(request)
    const samePath = request.wslDistro
      ? (a: string, b: string) => a === b
      : sameAgentInstallationPath
    const unique: Candidate[] = []
    for (const candidate of candidates) {
      if (!unique.some((entry) => samePath(entry.realPath, candidate.realPath))) {
        unique.push(candidate)
      }
    }
    const activeReal = candidates.find((entry) => samePath(entry.path, active ?? ''))?.realPath
    const defaultReal = candidates.find((entry) =>
      samePath(entry.path, defaultPath ?? '')
    )?.realPath
    const installations: AgentInstallation[] = []
    for (let index = 0; index < Math.min(unique.length, LIMIT); index += 3) {
      const batch = await Promise.all(
        unique.slice(index, Math.min(index + 3, LIMIT)).map(async (candidate) => {
          let source: AgentInstallationSource = candidate.source
          if (!request.wslDistro) {
            const homebrew = homebrewTargetFromPath(request.agent, candidate.realPath)
            if (homebrew && (await readHomebrewTargetVersion(homebrew, env).catch(() => null))) {
              source = homebrew.kind === 'cask' ? 'homebrew-cask' : 'homebrew-formula'
            } else if (!isHomebrewManagedPath(candidate.realPath)) {
              const packageName = NPM_AGENT_PACKAGES[request.agent]
              const target = resolveAgentUpgradeTarget(
                { ...request, commandOverride: quoteAgentExecutable(candidate.path) },
                packageName ?? '',
                env
              )
              source = target?.prefix
                ? 'npm'
                : await readManagedAgentSource(request, candidate.path, env).catch(
                    () => 'unknown' as const
                  )
              if (
                source === 'unknown' &&
                target?.args &&
                !['bun', 'uv', 'binary'].includes(
                  AGENT_INSTALL_PROVIDERS[request.agent]?.kind ?? ''
                )
              ) {
                source = 'self-update'
              }
            }
          }
          const version = await readAgentVersion({
            ...request,
            commandOverride: quoteAgentExecutable(candidate.path, request.wslDistro)
          })
          const ready = version.status === 'ready' && Boolean(version.version)
          return {
            ...candidate,
            command: quoteAgentExecutable(candidate.path, request.wslDistro),
            source,
            version: version.version,
            health: ready ? ('ready' as const) : ('broken' as const),
            isActive: Boolean(activeReal && samePath(candidate.realPath, activeReal)),
            isDefault: Boolean(defaultReal && samePath(candidate.realPath, defaultReal)),
            canUpgrade: ready && source !== 'unknown',
            ...(!ready
              ? { reason: version.reason ?? 'version-read-failed' }
              : source === 'unknown'
                ? { reason: 'upgrade-provider-unavailable' }
                : {})
          }
        })
      )
      installations.push(...batch)
    }
    return {
      status: 'ready',
      installations,
      conflict:
        installations.length > 1 &&
        new Set(installations.map((entry) => `${entry.health}:${entry.version}`)).size > 1,
      truncated: unique.length > LIMIT || candidates.length >= 64
    }
  } catch {
    return failure('environment-unverifiable')
  }
}
