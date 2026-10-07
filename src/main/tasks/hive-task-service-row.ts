import { z } from 'zod'
import type { HiveTaskView } from '../../shared/hive-tasks'
import { TaskExecutionResultSchema } from '../../shared/task-execution/task-execution-receipts'
import { refuseTaskExecution } from './task-execution-error'

export const HiveTaskServiceRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  status_version: z.coerce.number().int().nonnegative(),
  company_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  run_id: z.string().uuid(),
  workspace_selector: z.string().optional(),
  description: z.string().optional(),
  binding: z.unknown().optional(),
  run_scope: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('personal') }),
      z.object({
        kind: z.literal('workbenchCase'),
        projectId: z.string().uuid(),
        caseId: z.string().uuid(),
        workspaceRef: z.string().min(1).max(160)
      })
    ])
    .optional(),
  cancel_requested: z.boolean(),
  execution_stage: z.string().nullable().optional(),
  result_receipt: TaskExecutionResultSchema.nullable()
})
export const HiveTaskListRowSchema = HiveTaskServiceRowSchema.extend({
  result_receipt: z
    .object({
      status: z.enum(['succeeded', 'failed', 'cancelled']),
      artifactRefs: z.array(z.string().max(160)).max(32)
    })
    .nullable()
})
type Projection = z.infer<typeof HiveTaskListRowSchema>

export function projectHiveTask(row: Projection): HiveTaskView {
  return {
    id: row.id,
    runId: row.run_id,
    title: row.title,
    status:
      row.result_receipt?.status ??
      (row.execution_stage === 'outcome_unknown'
        ? 'unknown'
        : row.cancel_requested
          ? 'cancelRequested'
          : row.status === 'in_progress'
            ? 'running'
            : 'pending'),
    artifactRefs: row.result_receipt?.artifactRefs ?? []
  }
}

export const hiveTaskRunPath = (id: string, runId: string) =>
  `/hive/tasks/${z.string().uuid().parse(id)}/runs/${z.string().uuid().parse(runId)}`

export function parseHiveTaskRun(value: unknown, id: string, runId: string) {
  const task = HiveTaskServiceRowSchema.parse(value)
  if (task.id !== id || task.run_id !== runId) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  return task
}
