import type { AgentInstallRequest, AgentInstallResult } from '../../shared/agent-install-types'
import { hasReachedAppVersion } from '../../shared/app-version'
import { runProcess } from '../../shared/child-process/run-process'
import { stripAnsiEscapeSequences } from '../../shared/ansi-escape-sequences'
import { assertReviewedAgentTarget } from './agent-installation-identity'
import { readAgentVersion } from './agent-version-service'
import { quoteAgentExecutable, withAgentCommandOnPath } from './agent-upgrade-target'
import { readHomebrewTargetVersion, type AgentHomebrewTarget } from './agent-homebrew-target'

export async function upgradeHomebrewAgent(
  request: AgentInstallRequest,
  command: string,
  target: AgentHomebrewTarget,
  env: NodeJS.ProcessEnv
): Promise<AgentInstallResult> {
  const failed = (reason: string, output?: string): AgentInstallResult => ({
    status: 'error',
    version: null,
    reason,
    ...(output ? { output: stripAnsiEscapeSequences(output).slice(-4096) } : {})
  })
  const versionRequest = { agent: request.agent, commandOverride: quoteAgentExecutable(command) }
  const before = await readAgentVersion(versionRequest)
  if (before.status !== 'ready' || !before.version) {
    return failed('upgrade-target-unverifiable')
  }
  const expected = await readHomebrewTargetVersion(target, env)
  if (!expected) {
    return failed('upgrade-provider-unavailable')
  }
  assertReviewedAgentTarget(request, command, env)
  const result = await runProcess({
    program: target.program,
    args: ['upgrade', `--${target.kind}`, target.packageName],
    env: withAgentCommandOnPath(target.program, env),
    terminationBarrier: true,
    timeoutMs: 120_000,
    maxOutputBytes: 64 * 1024
  })
  const output = result.stderr || result.stdout
  if (result.timedOut) {
    return failed('install-timeout', output)
  }
  if (result.code !== 0) {
    return failed('install-failed', output)
  }
  const after = await readAgentVersion(versionRequest)
  if (
    after.status !== 'ready' ||
    !after.version ||
    !hasReachedAppVersion(after.version, expected) ||
    !hasReachedAppVersion(after.version, before.version)
  ) {
    return failed('install-verification-failed', output)
  }
  return { status: 'installed', version: after.version, previousVersion: before.version, command }
}
