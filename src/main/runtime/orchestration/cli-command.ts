import { PRIMARY_CLI_COMMAND } from '../../../shared/brand'
import type { ProjectExecutionRuntimeResolution } from '../../../shared/project-execution-runtime'

export type OrchestrationCliCommand = typeof PRIMARY_CLI_COMMAND | 'orca' | 'orca-dev' | 'orca-ide'

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
