import { realpathSync } from 'node:fs'
import { resolveWindowsCmdShim } from '../../shared/child-process/windows-cmd-shim-resolution'
import type { AgentInstallRequest } from '../../shared/agent-install-types'

export function agentInstallationRealPath(command: string, env: NodeJS.ProcessEnv): string {
  const shim = process.platform === 'win32' ? resolveWindowsCmdShim(command, env) : null
  return realpathSync(shim ? (shim.prefixArgs[0] ?? shim.program) : command)
}

export function sameAgentInstallationPath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

export function assertReviewedAgentTarget(
  request: AgentInstallRequest,
  command: string,
  env: NodeJS.ProcessEnv
): void {
  if (!request.expectedRealPath) {
    return
  }
  try {
    if (
      sameAgentInstallationPath(agentInstallationRealPath(command, env), request.expectedRealPath)
    ) {
      return
    }
  } catch {
    // Missing or replaced targets require a new inventory.
  }
  throw new Error('upgrade-target-changed')
}
