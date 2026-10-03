import path from 'node:path'
import { hasReachedAppVersion, compareAppVersions } from '../../shared/app-version'
import { withAgentNpmRegistry } from '../../shared/agent-npm-registry'
import {
  AGENT_UPGRADE_COMMANDS,
  type AgentInstallProvider
} from '../../shared/agent-install-providers'
import type { AgentInstallRequest, AgentInstallResult } from '../../shared/agent-install-types'
import { stripAnsiEscapeSequences } from '../../shared/ansi-escape-sequences'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveCliCommands } from '../../shared/node-cli-command-resolution'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { hydrateShellPathForAgentDetection } from '../ipc/agent-detection-shell-path'
import { buildLocalPreflightEnv } from '../ipc/preflight-local-env'
import { hydrateShellPath, mergePathSegments } from '../startup/hydrate-shell-path'
import { invalidatePersistedWindowsPathCache } from '../pty/windows-environment-path'
import { getWslGuestEnvironment } from '../wsl/wsl-guest-environment'
import { runWslProcess } from '../wsl/wsl-runner'
import { readAgentVersion, readLatestAgentVersion } from './agent-version-service'
import {
  agentExecutable,
  quoteAgentExecutable,
  withAgentCommandOnPath,
  verifyAgentBunOwnership
} from './agent-upgrade-target'
import { buildManagedGuestInstallScript } from './agent-managed-install-guest'
import { installOfficialScript } from './agent-script-install'
import { installAgentBinary } from './agent-binary-install'
import { ensureAgentBunRuntime } from './agent-install-runtime'
import { resolveInstalledWslAgent } from './agent-installed-wsl-command'
import { assertReviewedAgentTarget } from './agent-installation-identity'

const TIMEOUT_MS = 120_000
const failure = (reason: string, output?: string): AgentInstallResult => ({
  status: 'error',
  version: null,
  reason,
  ...(output ? { output: stripAnsiEscapeSequences(output).slice(-4096) } : {})
})

export async function installManagedAgent(
  request: AgentInstallRequest,
  provider: AgentInstallProvider
): Promise<AgentInstallResult> {
  const { agent, wslDistro } = request
  const upgrading = request.action === 'upgrade'
  const command = agentExecutable(request)
  if (!command) {
    return failure('upgrade-target-unverifiable')
  }
  let previousVersion: string | undefined
  let expectedVersion: string | null = null
  if (upgrading) {
    const before = await readAgentVersion({
      agent,
      commandOverride: request.commandOverride,
      wslDistro
    })
    if (before.status !== 'ready' || !before.version) {
      return failure('upgrade-target-unverifiable')
    }
    previousVersion = before.version
    const latest = await readLatestAgentVersion({ agent, registry: request.registry })
    if (latest.status === 'error') {
      return failure('upgrade-version-unavailable')
    }
    expectedVersion = latest.version
    if (hasReachedAppVersion(previousVersion, expectedVersion)) {
      return { status: 'installed', version: previousVersion, previousVersion }
    }
  }
  let result
  let bin: string | undefined
  let installedCommand: string | undefined
  if (wslDistro) {
    const guest = await getWslGuestEnvironment(wslDistro)
    if (!guest) {
      return failure('environment-unverifiable')
    }
    const minimumVersion =
      expectedVersion && previousVersion && compareAppVersions(expectedVersion, previousVersion) > 0
        ? expectedVersion
        : previousVersion
    const script = buildManagedGuestInstallScript(request, provider, guest, minimumVersion)
    if (!script) {
      return { status: 'unsupported', version: null, reason: 'install-provider-unavailable' }
    }
    result = await runWslProcess({
      distro: wslDistro,
      loginPath: 'none',
      script,
      timeoutMs: TIMEOUT_MS,
      maxOutputBytes: 64 * 1024
    })
    installedCommand = result.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith('__HIVE_AGENT_COMMAND__'))
      ?.slice('__HIVE_AGENT_COMMAND__'.length)
    if (provider.kind === 'script' && !upgrading && result.code === 0 && !result.timedOut) {
      try {
        installedCommand = await resolveInstalledWslAgent(agent, wslDistro)
      } catch (error) {
        return failure(error instanceof Error ? error.message : 'environment-unverifiable')
      }
    }
  } else {
    await hydrateShellPathForAgentDetection()
    const env = withAgentNpmRegistry(buildLocalPreflightEnv() ?? process.env, request.registry)
    const hostPath = process.platform === 'win32' ? path.win32 : path.posix
    const activeCommand = hostPath.isAbsolute(command)
      ? command
      : resolveCliCommands([command], { pathEnv: env.PATH ?? env.Path }).get(command)
    if (upgrading && activeCommand) {
      assertReviewedAgentTarget(request, activeCommand, env)
    }
    if (provider.kind === 'binary') {
      try {
        const installed = await installAgentBinary(request, provider, activeCommand, {
          previousVersion,
          expectedVersion
        })
        installedCommand = installed.command
        bin = installed.bin
        result = { code: 0, stdout: '', stderr: '', timedOut: false }
      } catch (error) {
        return failure(error instanceof Error ? error.message : 'install-failed')
      }
    } else if (provider.kind === 'script') {
      if (provider.unsupportedArchitectures?.includes(`${process.platform}-${process.arch}`)) {
        return { status: 'unsupported', version: null, reason: 'install-platform-unavailable' }
      }
      if (upgrading) {
        const args = AGENT_UPGRADE_COMMANDS[agent]
        if (!activeCommand || !args) {
          return failure('upgrade-provider-unavailable')
        }
        result = await runProcess({
          program: activeCommand,
          args: [...args],
          env: withAgentCommandOnPath(activeCommand, env),
          terminationBarrier: true,
          timeoutMs: TIMEOUT_MS,
          maxOutputBytes: 64 * 1024
        })
        installedCommand = activeCommand
      } else {
        const url = process.platform === 'win32' ? provider.windowsUrl : provider.posixUrl
        if (!url) {
          return { status: 'unsupported', version: null, reason: 'install-platform-unavailable' }
        }
        try {
          result = await installOfficialScript(
            url,
            { ...env, ...provider.env },
            (process.platform === 'win32' ? provider.windowsArgs : provider.posixArgs) ?? []
          )
        } catch (error) {
          return failure(error instanceof Error ? error.message : 'installer-download-failed')
        }
        if (process.platform === 'win32') {
          invalidatePersistedWindowsPathCache()
        }
        const hydration = await hydrateShellPath({ force: true })
        if (hydration.ok) {
          mergePathSegments(hydration.segments)
        }
        const refreshedEnv = buildLocalPreflightEnv() ?? process.env
        installedCommand = resolveCliCommands([TUI_AGENT_CONFIG[agent].detectCmd], {
          pathEnv: refreshedEnv.PATH ?? refreshedEnv.Path
        }).get(TUI_AGENT_CONFIG[agent].detectCmd)
      }
    } else if (provider.kind === 'bun' || provider.kind === 'uv') {
      const manager = resolveCliCommands([provider.kind], { pathEnv: env.PATH ?? env.Path }).get(
        provider.kind
      )
      if (!manager) {
        return failure(provider.kind === 'bun' ? 'bun-unavailable' : 'uv-unavailable')
      }
      if (provider.kind === 'bun') {
        try {
          await ensureAgentBunRuntime(env, manager)
        } catch {
          return failure('bun-unavailable', 'OMP requires Bun 1.3.14 or later.')
        }
      }
      const directory = await runProcess({
        program: manager,
        args: provider.kind === 'bun' ? ['pm', 'bin', '--global'] : ['tool', 'dir', '--bin'],
        env,
        timeoutMs: 10_000,
        maxOutputBytes: 4096
      })
      bin = directory.stdout.trim()
      if (
        directory.code !== 0 ||
        directory.timedOut ||
        directory.outputTruncated ||
        !hostPath.isAbsolute(bin)
      ) {
        return failure('install-directory-unverifiable')
      }
      const activeBin = activeCommand ? hostPath.dirname(activeCommand) : ''
      if (
        upgrading &&
        (!activeCommand ||
          (process.platform === 'win32'
            ? activeBin.toLowerCase() !== bin.toLowerCase()
            : activeBin !== bin))
      ) {
        return failure('upgrade-provider-unavailable')
      }
      const args =
        provider.kind === 'bun'
          ? [
              'add',
              '--global',
              `${provider.packageName}@latest`,
              '--registry',
              env.npm_config_registry!
            ]
          : upgrading
            ? ['tool', 'upgrade', provider.packageName]
            : ['tool', 'install', '--python', '3.12', '--with', 'pip', provider.packageName]
      if (
        upgrading &&
        provider.kind === 'bun' &&
        !(await verifyAgentBunOwnership(request, activeCommand!, manager, env))
      ) {
        return failure('upgrade-provider-unavailable')
      }
      if (upgrading) {
        assertReviewedAgentTarget(request, activeCommand!, env)
      }
      result = await runProcess({
        program: manager,
        args,
        env,
        terminationBarrier: true,
        timeoutMs: TIMEOUT_MS,
        maxOutputBytes: 64 * 1024
      })
      installedCommand = resolveCliCommands([TUI_AGENT_CONFIG[agent].detectCmd], {
        pathEnv: `${bin}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? env.Path ?? ''}`
      }).get(TUI_AGENT_CONFIG[agent].detectCmd)
      const installedBin = installedCommand ? hostPath.dirname(installedCommand) : ''
      if (
        (process.platform === 'win32'
          ? installedBin.toLowerCase() !== bin.toLowerCase()
          : installedBin !== bin) ||
        (upgrading && installedCommand !== activeCommand)
      ) {
        installedCommand = undefined
      }
    } else {
      return { status: 'unsupported', version: null, reason: 'install-provider-unavailable' }
    }
  }
  if (result.timedOut || (wslDistro && [124, 137].includes(result.code ?? 0))) {
    return failure('install-timeout', result.stderr || result.stdout)
  }
  if (result.code !== 0) {
    return failure(
      result.code === 123
        ? 'upgrade-target-changed'
        : result.code === 127
          ? 'installer-runtime-unavailable'
          : result.code === 125
            ? 'upgrade-provider-unavailable'
            : 'install-failed',
      result.stderr || result.stdout
    )
  }
  if (!installedCommand) {
    return failure('install-verification-failed')
  }
  const version = await readAgentVersion({
    agent,
    wslDistro,
    commandOverride: quoteAgentExecutable(installedCommand, wslDistro)
  })
  if (
    version.status !== 'ready' ||
    (expectedVersion && !hasReachedAppVersion(version.version ?? '', expectedVersion)) ||
    (previousVersion && !hasReachedAppVersion(version.version ?? '', previousVersion)) ||
    (previousVersion &&
      !expectedVersion &&
      compareAppVersions(version.version ?? '', previousVersion) <= 0)
  ) {
    return failure('install-verification-failed', result.stderr || result.stdout)
  }
  if (bin && !upgrading) {
    mergePathSegments([bin])
  }
  return {
    status: 'installed',
    version: version.version,
    ...(previousVersion ? { previousVersion } : {})
  }
}
