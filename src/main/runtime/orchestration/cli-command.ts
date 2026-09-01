import { PRIMARY_CLI_COMMAND } from '../../../shared/brand'
import type { ProjectExecutionRuntimeResolution } from '../../../shared/project-execution-runtime'

export type OrchestrationCliCommand = typeof PRIMARY_CLI_COMMAND | 'orca' | 'orca-ide'

export function resolveTerminalOrchestrationCliCommand(_args: {
  connectionId: string | null
  isWsl: boolean | null | undefined
  worktreeId: string
  projectRuntime?: ProjectExecutionRuntimeResolution
}): OrchestrationCliCommand {
  // The primary launcher is now installed on every supported host, including
  // WSL. Legacy names remain accepted aliases, but new agent instructions must
  // not advertise them.
  return PRIMARY_CLI_COMMAND
}
