import type { HiveWorkflowCaseRun } from '../../../../../shared/hive-workflow-case-runs'
import type { HiveWorkflowCaseArtifactPreview } from './hive-workflow-case-run-responses'

export type HiveWorkflowCaseRunsState = {
  scope: string
  runs: HiveWorkflowCaseRun[]
  artifact: HiveWorkflowCaseArtifactPreview | null
  pending: 'observe' | 'start' | 'cancel' | 'artifact' | null
  error: string | null
  loaded: boolean
  uncertain: boolean
  resumable: boolean
}
export const emptyWorkflowCaseRunsState = (scope: string): HiveWorkflowCaseRunsState => ({
  scope,
  runs: [],
  artifact: null,
  pending: null,
  error: null,
  loaded: false,
  uncertain: false,
  resumable: false
})
