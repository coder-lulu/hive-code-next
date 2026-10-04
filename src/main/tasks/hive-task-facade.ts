import { z } from 'zod'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { HiveTaskCreateSchema, type HiveTasksApi, type HiveTaskView } from '../../shared/hive-tasks'
import { TaskExecutionResultSchema } from '../../shared/task-execution/task-execution-receipts'
import type { createLocalTaskRequest } from './local-task-http-client'
import { createHiveTaskServiceContext } from './hive-task-service-context'
import type { TaskArtifactIndex } from './task-artifact-index'
import type { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { refuseTaskExecution } from './task-execution-error'
import {
  createHiveTeamWorkbenchFacade,
  type HiveTaskWorkspaceProof
} from './hive-team-workbench-facade'
import { createHiveTaskWorkflowFacade } from './hive-task-workflow-facade'
import { createHiveWorkflowCaseFacade } from './hive-workflow-case-facade'

const Task = z.object({
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
  cancel_requested: z.boolean(),
  execution_stage: z.string().nullable().optional(),
  result_receipt: TaskExecutionResultSchema.nullable()
})
type TaskRow = z.infer<typeof Task>
const ListTask = Task.extend({
  result_receipt: z
    .object({
      status: z.enum(['succeeded', 'failed', 'cancelled']),
      artifactRefs: z.array(z.string().max(160)).max(32)
    })
    .nullable()
})
type Projection = Omit<TaskRow, 'result_receipt'> & {
  result_receipt: Pick<NonNullable<TaskRow['result_receipt']>, 'status' | 'artifactRefs'> | null
}
function project(row: Projection): HiveTaskView {
  return {
    id: row.id,
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

/** Only the authenticated desktop Facade may turn a business task into a Runtime binding. */
export function createHiveTaskFacade(options: {
  descriptorPath: string
  artifacts: TaskArtifactIndex
  issuer: Pick<LocalTaskBindingIssuer, 'issue'>
  currentAccount: () => HiveRuntimeCloudAuthorization | null
  validateWorkspace: (selector: string) => Promise<HiveTaskWorkspaceProof>
  assertCurrent(): void
  request?: typeof createLocalTaskRequest
}): HiveTasksApi {
  const context = createHiveTaskServiceContext(options)
  const workbench = createHiveTeamWorkbenchFacade({
    context,
    validateWorkspace: options.validateWorkspace
  })
  const workflows = createHiveTaskWorkflowFacade({
    context,
    getTeam: workbench.getTeam,
    validateWorkspace: options.validateWorkspace
  })
  const taskPath = (id: string) => `/hive/tasks/${z.string().uuid().parse(id)}`
  return {
    ...workbench,
    ...workflows,
    ...createHiveWorkflowCaseFacade({
      context,
      getTeam: workbench.getTeam,
      getWorkflow: workflows.getWorkflow,
      validateWorkspace: options.validateWorkspace
    }),
    async list() {
      const caller = await context()
      return z
        .array(ListTask)
        .max(100)
        .parse(await caller.request('/hive/tasks'))
        .map(project)
    },
    async create(rawInput) {
      const input = HiveTaskCreateSchema.parse(rawInput)
      const caller = await context()
      const workspace = await options.validateWorkspace(input.workspaceSelector)
      workspace.assertCurrent()
      caller.assertCurrent()
      const task = Task.parse(await caller.request('/hive/tasks', input))
      if (task.result_receipt) {
        return project(task)
      }
      if (
        !task.company_id ||
        !task.agent_id ||
        task.description !== input.input ||
        task.workspace_selector !== input.workspaceSelector
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      // The durable Paperclip task precedes the durable binding, which precedes dispatch.
      const binding = await options.issuer.issue({
        paperclipCompanyId: task.company_id,
        paperclipAgentId: task.agent_id,
        task: {
          spaceId: task.company_id,
          taskId: task.id,
          runId: task.run_id,
          attempt: 1,
          taskRevision: String(task.binding ? task.status_version - 1 : task.status_version)
        },
        workspaceSelector: input.workspaceSelector,
        input: task.description
      })
      workspace.assertCurrent()
      caller.assertCurrent()
      const bound = Task.parse(await caller.request(`${taskPath(task.id)}/binding`, binding))
      await caller.request(`${taskPath(task.id)}/dispatch`, {})
      return project(bound)
    },
    async cancel(id) {
      const caller = await context()
      return project(Task.parse(await caller.request(`${taskPath(id)}/cancel`, {})))
    },
    async artifact(id, ref) {
      const caller = await context()
      const task = Task.parse(await caller.request(taskPath(id)))
      if (!task.result_receipt?.artifactRefs.includes(ref) || !task.result_receipt.outcomeRef) {
        return refuseTaskExecution('FORBIDDEN')
      }
      const artifact = await options.artifacts.read(task.result_receipt.outcomeRef, ref)
      caller.assertCurrent()
      return artifact
    }
  }
}
