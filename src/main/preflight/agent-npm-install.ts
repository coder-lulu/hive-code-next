import path from 'node:path'
import { hasReachedAppVersion } from '../../shared/app-version'
import { AGENT_NPM_REGISTRIES, withAgentNpmRegistry } from '../../shared/agent-npm-registry'
import type { AgentInstallRequest, AgentInstallResult } from '../../shared/agent-install-types'
import { stripAnsiEscapeSequences } from '../../shared/ansi-escape-sequences'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveCliCommands, withCliRuntimeOnPath } from '../../shared/node-cli-command-resolution'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { hydrateShellPathForAgentDetection } from '../ipc/agent-detection-shell-path'
import { buildLocalPreflightEnv } from '../ipc/preflight-local-env'
import { mergePathSegments } from '../startup/hydrate-shell-path'
import { getWslGuestEnvironment } from '../wsl/wsl-guest-environment'
import { runWslProcess } from '../wsl/wsl-runner'
import { readAgentVersion, readLatestAgentVersion } from './agent-version-service'
import {
  quoteAgentExecutable,
  resolveAgentUpgradeTarget,
  withAgentCommandOnPath
} from './agent-upgrade-target'
import { buildNpmGuestInstallScript } from './agent-npm-install-guest'
import { ensureAgentBunRuntime } from './agent-install-runtime'
import { assertReviewedAgentTarget } from './agent-installation-identity'

const INSTALL_TIMEOUT_MS = 120_000
const failed = (reason: string, output?: string): AgentInstallResult => ({
  status: 'error',
  version: null,
  reason,
  ...(output ? { output: stripAnsiEscapeSequences(output).slice(-4096) } : {})
})

export async function installNpmAgent(
  request: AgentInstallRequest,
  packageName: string
): Promise<AgentInstallResult> {
  const { agent, wslDistro } = request
  const upgrading = request.action === 'upgrade'
  const registry = AGENT_NPM_REGISTRIES[request.registry ?? 'default']
  let previousVersion: string | undefined
  let expectedVersion: string | null = null
  if (upgrading) {
    const before = await readAgentVersion({
      agent,
      wslDistro,
      commandOverride: request.commandOverride
    })
    if (before.status !== 'ready' || !before.version) {
      return failed('upgrade-target-unverifiable')
    }
    previousVersion = before.version
    const latest = await readLatestAgentVersion({ agent, registry: request.registry })
    if (latest.status === 'error') {
      return failed('upgrade-version-unavailable')
    }
    expectedVersion = latest.version
    if (hasReachedAppVersion(previousVersion, expectedVersion)) {
      return { status: 'installed', version: previousVersion, previousVersion }
    }
  }
  let result
  let installedCommand: string | undefined
  let installedBin: string | undefined
  if (wslDistro) {
    const guest = await getWslGuestEnvironment(wslDistro)
    if (!guest) {
      return failed('environment-unverifiable')
    }
    const script = buildNpmGuestInstallScript(request, packageName, guest)
    result = await runWslProcess({
      distro: wslDistro,
      loginPath: 'none',
      script,
      timeoutMs: INSTALL_TIMEOUT_MS,
      maxOutputBytes: 64 * 1024
    })
    const prefix = result.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith('__HIVE_AGENT_INSTALL_PREFIX__'))
      ?.slice('__HIVE_AGENT_INSTALL_PREFIX__'.length)
    if (prefix?.startsWith('/')) {
      installedCommand = path.posix.join(prefix, 'bin', TUI_AGENT_CONFIG[agent].detectCmd)
    }
    const active = result.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith('__HIVE_AGENT_COMMAND__'))
      ?.slice('__HIVE_AGENT_COMMAND__'.length)
    if (active?.startsWith('/')) {
      installedCommand = active
    }
  } else {
    await hydrateShellPathForAgentDetection()
    const env = withAgentNpmRegistry(buildLocalPreflightEnv() ?? process.env, request.registry)
    const pathEnv = env.PATH ?? env.Path
    const upgradeTarget = upgrading ? resolveAgentUpgradeTarget(request, packageName, env) : null
    if (upgrading && !upgradeTarget) {
      return failed('upgrade-provider-unavailable')
    }
    if (upgradeTarget?.args) {
      assertReviewedAgentTarget(request, upgradeTarget.command, env)
      result = await runProcess({
        program: upgradeTarget.command,
        args: [...upgradeTarget.args],
        env: withAgentCommandOnPath(upgradeTarget.command, env),
        terminationBarrier: true,
        timeoutMs: INSTALL_TIMEOUT_MS,
        maxOutputBytes: 64 * 1024
      })
      installedCommand = upgradeTarget.command
    } else {
      if (agent === 'omp') {
        try {
          await ensureAgentBunRuntime(env)
        } catch {
          return failed('bun-unavailable')
        }
      }
      const targetEnv = upgradeTarget ? withAgentCommandOnPath(upgradeTarget.command, env) : env
      const tools = resolveCliCommands(['npm', 'node'], {
        pathEnv: targetEnv.PATH ?? targetEnv.Path
      })
      const npm = tools.get('npm') ?? 'npm'
      const runEnv = withCliRuntimeOnPath(npm, targetEnv)
      const node = await runProcess({
        program: tools.get('node') ?? 'node',
        args: ['--version'],
        env: runEnv,
        timeoutMs: 10_000,
        maxOutputBytes: 4096
      }).catch(() => null)
      const prefix = await runProcess({
        program: npm,
        args: ['prefix', '--global'],
        env: runEnv,
        timeoutMs: 10_000,
        maxOutputBytes: 4096
      }).catch(() => null)
      if (
        !node ||
        node.code !== 0 ||
        node.timedOut ||
        !prefix ||
        prefix.code !== 0 ||
        prefix.timedOut
      ) {
        return failed('node-npm-unavailable')
      }
      const hostPath = process.platform === 'win32' ? path.win32 : path.posix
      const globalPrefix = upgradeTarget?.prefix ?? prefix.stdout.trim()
      if (!hostPath.isAbsolute(globalPrefix) || prefix.outputTruncated) {
        return failed('node-npm-unavailable')
      }
      if (upgradeTarget) {
        assertReviewedAgentTarget(request, upgradeTarget.command, runEnv)
      }
      result = await runProcess({
        program: npm,
        args: [
          'install',
          '--global',
          `${packageName}@latest`,
          '--registry',
          registry,
          ...(upgradeTarget?.prefix ? ['--prefix', upgradeTarget.prefix] : []),
          '--no-fund',
          '--no-audit',
          '--engine-strict'
        ],
        env: runEnv,
        terminationBarrier: true,
        timeoutMs: INSTALL_TIMEOUT_MS,
        maxOutputBytes: 64 * 1024
      })
      const bin = process.platform === 'win32' ? globalPrefix : hostPath.join(globalPrefix, 'bin')
      installedBin = bin
      const command = TUI_AGENT_CONFIG[agent].detectCmd
      installedCommand = resolveCliCommands([command], {
        pathEnv: `${bin}${process.platform === 'win32' ? ';' : ':'}${pathEnv ?? ''}`
      }).get(command)
      const commandDir = installedCommand ? hostPath.dirname(installedCommand) : ''
      const matches =
        process.platform === 'win32'
          ? commandDir.toLowerCase() === bin.toLowerCase()
          : commandDir === bin
      if (!installedCommand || !matches) {
        installedCommand = undefined
      }
      if (upgradeTarget && installedCommand && installedCommand !== upgradeTarget.command) {
        installedCommand = undefined
      }
    }
  }
  if (result.timedOut || (wslDistro && (result.code === 124 || result.code === 137))) {
    return failed('install-timeout', result.stderr || result.stdout)
  }
  if (result.code !== 0) {
    return failed(
      result.code === 123
        ? 'upgrade-target-changed'
        : result.code === 127
          ? 'node-npm-unavailable'
          : result.code === 125
            ? 'upgrade-provider-unavailable'
            : 'install-failed',
      result.stderr || result.stdout
    )
  }
  if (!installedCommand) {
    return failed('install-verification-failed', result.stderr || result.stdout)
  }
  const quotedCommand = quoteAgentExecutable(installedCommand, wslDistro)
  const version = await readAgentVersion({ agent, wslDistro, commandOverride: quotedCommand })
  if (
    version.status !== 'ready' ||
    (expectedVersion && !hasReachedAppVersion(version.version ?? '', expectedVersion))
  ) {
    return failed('install-verification-failed', result.stderr || result.stdout)
  }
  if (installedBin && !upgrading) {
    mergePathSegments([installedBin])
  }
  return {
    status: 'installed',
    version: version.version,
    ...(previousVersion ? { previousVersion } : {})
  }
}
