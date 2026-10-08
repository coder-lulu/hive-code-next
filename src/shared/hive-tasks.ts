import { z } from 'zod'
import type { HiveTeamWorkbenchApi } from './hive-team-workbench'
import type { HiveTaskWorkflowsApi } from './hive-task-workflows'
import type { HiveWorkflowCasesApi } from './hive-workflow-cases'
import type { HiveWorkflowCaseRunsApi } from './hive-workflow-case-runs'
import type { HiveWorkflowCaseCodeApi } from './hive-workflow-case-code'
import type { HiveWorkflowCaseSessionApi } from './hive-workflow-case-session'

export const HiveTaskCreateSchema = z.strictObject({
  requestId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  input: z.string().trim().min(1).max(48_000),
  workspaceSelector: z.string().min(1).max(512)
})
export type HiveTaskCreate = z.infer<typeof HiveTaskCreateSchema>
export type HiveTaskView = {
  id: string
  runId: string
  title: string
  status:
    | 'pending'
    | 'running'
    | 'cancelRequested'
    | 'unknown'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
  artifactRefs: string[]
}
export type HiveTaskArtifact = { name: string; text: string }
export type HiveTasksApi = HiveTeamWorkbenchApi &
  HiveTaskWorkflowsApi &
  HiveWorkflowCasesApi &
  HiveWorkflowCaseCodeApi &
  HiveWorkflowCaseSessionApi &
  HiveWorkflowCaseRunsApi & {
    list(): Promise<HiveTaskView[]>
    create(input: HiveTaskCreate): Promise<HiveTaskView>
    cancel(taskId: string, runId: string): Promise<HiveTaskView>
    artifact(taskId: string, runId: string, artifactRef: string): Promise<HiveTaskArtifact>
  }
