import type { HiveTasksApi } from '../../shared/hive-tasks'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { LocalTaskRuntimeOwner } from './local-task-binding-options'

export type HiveTeamTaskToolOptions = {
  facade: Pick<
    HiveTasksApi,
    | 'listCompanies'
    | 'listProjects'
    | 'listWorkflows'
    | 'getTeam'
    | 'createWorkflowCase'
    | 'startWorkflowCase'
    | 'getWorkflowCase'
    | 'getWorkflowCaseRuns'
  >
  directory: string
  resolveWorkspaceSource(selector: string): Promise<{ path: string; assertCurrent(): void }>
  currentAccount(): HiveRuntimeCloudAuthorization | null
  currentRuntime(): LocalTaskRuntimeOwner | null
  assertCurrent(): void
}
