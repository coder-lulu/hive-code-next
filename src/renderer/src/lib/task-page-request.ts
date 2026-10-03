import type { TaskPageData } from '../store/slices/ui/ui-slice-contract-core'

export function isExternalTaskPageRequest(data: TaskPageData): boolean {
  return Boolean(
    data.taskSource ||
    data.preselectedRepoId ||
    data.prefilledName ||
    data.openGitHubWorkItem ||
    data.openGitLabWorkItem ||
    data.openLinearIssue ||
    data.openJiraIssue
  )
}
