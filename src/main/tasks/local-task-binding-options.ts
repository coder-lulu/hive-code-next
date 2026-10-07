import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { LocalTaskBindingInput } from './local-task-binding-file'
import type { TaskExecutionRecord, TaskExecutionWorkspace } from './task-execution-record'
import type { createTaskManagedCopy } from './task-managed-copy'
import type { TaskDockerEnforcement } from './task-docker-enforcement'

export type LocalTaskRuntimeOwner = Readonly<{
  runtimeRecordId: string
  ownershipEpoch: number
  accountId: string
}>

export type LocalTaskBindingIssuerOptions = {
  directory: string
  operationCallerKey: string
  currentAccount(): HiveRuntimeCloudAuthorization | null
  currentRuntime(): LocalTaskRuntimeOwner | null
  resolveSource(selector: string): Promise<{ path: string; assertCurrent(): void }>
  restoreCodeInput?: (
    input: LocalTaskBindingInput,
    directory: string,
    assertCurrent: () => void
  ) => ReturnType<typeof createTaskManagedCopy>
  registerWorkspace(path: string): Promise<{ workspaceId: string; assertCurrent(): void }>
  readExecution(command: TaskExecutionRecord['command']): TaskExecutionRecord | null
  restoreWorkspace(workspace: TaskExecutionWorkspace): Promise<{ assertCurrent(): void }>
  resolveEnforcement?: () => Promise<TaskDockerEnforcement>
  assertCurrent?: () => void
  now?: () => number
}
