import type { ManagedProviderProcess } from '../provider-process/managed-provider-process'
import { PROVIDER_SUPERVISOR_MAX_STOP_MS } from '../provider-process/provider-process-supervisor'
import type {
  ProviderProcessClosePolicy,
  ProviderProcessCloseResult
} from '../provider-process/provider-process-close'
import type { ClaudeChildTreeReaper } from './claude-agent-sdk-exit-proof'

export const GRACEFUL_EXIT_MS = 1_500
// A signalled supervisor escalates on its own; forcing it sooner kills it and orphans Claude.
export const SUPERVISED_GRACEFUL_EXIT_MS = PROVIDER_SUPERVISOR_MAX_STOP_MS + 500
const FORCED_EXIT_MS = 1_000

export function claudeChildClosePolicy(
  supervised: boolean,
  _platform: NodeJS.Platform = process.platform
): ProviderProcessClosePolicy {
  return {
    gracefulExitMs: supervised ? SUPERVISED_GRACEFUL_EXIT_MS : GRACEFUL_EXIT_MS,
    forcedExitMs: FORCED_EXIT_MS,
    signalSupervisorOnClose: true,
    // Root exit never substitutes for descendant exit evidence.
    selfExitIsClose: false
  }
}

/** The root exited and its captured tree was observed gone. */
export function claudeChildCloseProven(result: ProviderProcessCloseResult): boolean {
  return result.root === 'exited' && result.tree === 'exited'
}

export type ClaudeChildExitProofInput = {
  managed: ManagedProviderProcess
  tree?: ClaudeChildTreeReaper
}

export async function proveClaudeChildExitWithReaper(
  input: ClaudeChildExitProofInput,
  createTree: () => ClaudeChildTreeReaper
): Promise<boolean> {
  return claudeChildCloseProven(await input.managed.close(input.tree ?? createTree()))
}
