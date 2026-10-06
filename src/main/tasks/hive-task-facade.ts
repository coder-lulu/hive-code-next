import { z } from 'zod'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { HiveTaskCreateSchema, type HiveTasksApi } from '../../shared/hive-tasks'
import {
  HiveTaskServiceRowSchema as Task,
  HiveTaskListRowSchema as ListTask,
  projectHiveTask as project,
  parseHiveTaskRun as parseTaskRun,
  hiveTaskRunPath
} from './hive-task-service-row'
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
import { createHiveWorkflowCaseRunFacade } from './hive-workflow-case-run-facade'
import { bindAndDispatchHiveTask } from './hive-task-run-dispatch'
import { prepareWorkflowCaseCancellation } from './hive-workflow-case-cancellation'

/** Only the authenticated desktop Facade may turn a business task into a Runtime binding. */
export function createHiveTaskFacade(options: {
  descriptorPath: string
  artifacts: TaskArtifactIndex
  issuer: Pick<LocalTaskBindingIssuer, 'issue'>
  currentAccount: () => HiveRuntimeCloudAuthorization | null
  validateWorkspace: (selector: string) => Promise<HiveTaskWorkspaceProof>
  enforcement?: () => Promise<{ assertCurrent(): void }>
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
  const taskPath = hiveTaskRunPath
  const cases = createHiveWorkflowCaseFacade({
    context,
    getTeam: workbench.getTeam,
    getWorkflow: workflows.getWorkflow,
    validateWorkspace: options.validateWorkspace,
    enforcement: options.enforcement
  })
  return {
    ...workbench,
    ...workflows,
    ...cases,
    ...createHiveWorkflowCaseRunFacade({
      context,
      getWorkflowCase: cases.getWorkflowCase,
      workspaceSelector: async (projectId) =>
        (await workbench.getTeam(projectId)).project.workspaceSelector,
      validateWorkspace: options.validateWorkspace,
      issuer: options.issuer,
      enforcement: options.enforcement
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
      const bound = await bindAndDispatchHiveTask({
        caller,
        issuer: options.issuer,
        workspace,
        companyId: task.company_id,
        employeeRef: task.agent_id,
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
      return project(bound)
    },
    async cancel(id, runId) {
      const path = taskPath(id, runId)
      const caller = await context()
      let task = parseTaskRun(await caller.request(`${path}/cancel`, {}), id, runId)
      if (!task.binding && !task.result_receipt && task.run_scope?.kind === 'workbenchCase') {
        if (!task.company_id || !task.agent_id) {
          return refuseTaskExecution('REVISION_CONFLICT')
        }
        await prepareWorkflowCaseCancellation({
          caller,
          issuer: options.issuer,
          validateWorkspace: options.validateWorkspace,
          taskId: id,
          runId,
          projectId: task.run_scope.projectId,
          caseId: task.run_scope.caseId,
          companyId: task.company_id,
          employeeRef: task.agent_id,
          workspaceRef: task.run_scope.workspaceRef
        })
        task = parseTaskRun(await caller.request(`${path}/cancel`, {}), id, runId)
      }
      return project(task)
    },
    async artifact(id, runId, ref) {
      const path = taskPath(id, runId)
      const caller = await context()
      const task = parseTaskRun(await caller.request(path), id, runId)
      if (!task.result_receipt?.artifactRefs.includes(ref) || !task.result_receipt.outcomeRef) {
        return refuseTaskExecution('FORBIDDEN')
      }
      const artifact = await options.artifacts.read(task.result_receipt.outcomeRef, ref)
      caller.assertCurrent()
      return artifact
    }
  }
}
