import type { LocalAgentRuntime } from './CliSkillRuntimeSetup'
import { buildSkillSetupTerminalCommand } from './CliSkillRuntimeSetup'

export type SkillTerminalSnapshot = {
  copiedCommand: string
  prepareCommandForShell: (command: string, effectiveShell: string | undefined) => string
  shellOverride: string | undefined
  pinnedSetupRuntimeEnvironmentId: string | null
  onRecheck?: () => void | Promise<unknown>
  freshnessSkillName?: string
}

export function createTerminalSnapshot(
  copiedCommand: string,
  shellOverride: string | undefined,
  runtime: LocalAgentRuntime | undefined,
  pinnedSetupRuntimeEnvironmentId: string | null
): SkillTerminalSnapshot {
  const pinnedRuntime = runtime ? { ...runtime } : undefined
  return {
    copiedCommand,
    pinnedSetupRuntimeEnvironmentId,
    prepareCommandForShell: (command, effectiveShell) =>
      buildSkillSetupTerminalCommand(command, effectiveShell, pinnedRuntime),
    shellOverride
  }
}
