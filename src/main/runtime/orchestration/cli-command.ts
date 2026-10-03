import { PRIMARY_CLI_COMMAND } from '../../../shared/brand'
import type { ProjectExecutionRuntimeResolution } from '../../../shared/project-execution-runtime'

export type OrchestrationCliCommand = typeof PRIMARY_CLI_COMMAND | 'orca' | 'orca-dev' | 'orca-ide'

/** Every Hive build uses the installed product launcher. */
export function runtimeOrchestrationCliCommand(): OrchestrationCliCommand {
  return PRIMARY_CLI_COMMAND
}

/** What a local, non-WSL terminal is told to run; a structured session is always one. */
export function localOrchestrationCliCommand(): OrchestrationCliCommand {
  return PRIMARY_CLI_COMMAND
}

export function resolveTerminalOrchestrationCliCommand(_args: {
  connectionId: string | null
  isWsl: boolean | null | undefined
  worktreeId: string
  projectRuntime?: ProjectExecutionRuntimeResolution
  runtimeCliCommand?: OrchestrationCliCommand
}): OrchestrationCliCommand {
  // HiveCode installs its primary launcher on local, WSL, and SSH hosts.
  return PRIMARY_CLI_COMMAND
}
