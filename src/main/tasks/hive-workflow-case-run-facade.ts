import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import {
  HiveWorkflowCaseStartSchema,
  HiveWorkflowCaseRunAdmissionSchema,
  HiveWorkflowCaseRunsSchema,
  type HiveWorkflowCaseRun,
  type HiveWorkflowCaseRunsApi
} from '../../shared/hive-workflow-case-runs'
import {
  HiveWorkflowCaseReadQuerySchema,
  type HiveWorkflowCasesApi,
  type HiveWorkflowCaseView
} from '../../shared/hive-workflow-cases'
import { hiveWorkflowStagePrompt } from '../../shared/hive-workflow-stage-prompt'
import { hiveWorkflowStageContext } from '../../shared/hive-workflow-stage-context'
import type { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import {
  assertHiveWorkbenchCompanyOwner,
  type HiveTaskRequestContext,
  type HiveTaskWorkspaceProof
} from './hive-team-workbench-facade'
import { bindAndDispatchHiveTask } from './hive-task-run-dispatch'
import { refuseTaskExecution } from './task-execution-error'

function assertRunScope(run: HiveWorkflowCaseRun, view: HiveWorkflowCaseView) {
  const task = view.stageTasks.find((candidate) => candidate.stageRef === run.stageRef)
  const stage = view.workflow.definition.stages.find(
    (candidate) => candidate.stageRef === run.stageRef
  )
  if (
    run.caseId !== view.id ||
    run.task.spaceId !== view.binding.scope.companyRef ||
    run.startRequest.projectId !== view.binding.scope.projectRef ||
    !task ||
    !stage ||
    task.taskId !== run.task.taskId ||
    task.employeeRef !== run.employeeRef ||
    task.role !== run.role ||
    run.task.attempt > stage.maxAttempts
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
}

export function createHiveWorkflowCaseRunFacade(options: {
  context(): Promise<HiveTaskRequestContext>
  getWorkflowCase: HiveWorkflowCasesApi['getWorkflowCase']
  workspaceSelector(projectId: string): Promise<string>
  validateWorkspace(selector: string): Promise<HiveTaskWorkspaceProof>
  issuer: Pick<LocalTaskBindingIssuer, 'issue'>
  enforcement?: () => Promise<{ assertCurrent(): void }>
}): HiveWorkflowCaseRunsApi {
  return {
    async getWorkflowCaseRuns(rawQuery) {
      const query = HiveWorkflowCaseReadQuerySchema.parse(rawQuery)
      const caller = await options.context()
      const view = await options.getWorkflowCase(query)
      caller.assertCurrent()
      assertHiveWorkbenchCompanyOwner(view.team.company, caller.accountRef)
      const runs = HiveWorkflowCaseRunsSchema.parse(
        await caller.request('/hive/workbench/cases/runs', query)
      )
      const ids = new Set<string>()
      for (const run of runs) {
        assertRunScope(run, view)
        if (ids.has(run.task.runId)) {
          return refuseTaskExecution('REVISION_CONFLICT')
        }
        ids.add(run.task.runId)
      }
      return runs
    },
    async startWorkflowCase(rawInput) {
      const input = HiveWorkflowCaseStartSchema.parse(rawInput)
      const caller = await options.context()
      if (!options.enforcement) {
        return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
      }
      const enforcement = await options.enforcement()
      caller.assertCurrent()
      enforcement.assertCurrent()
      const view = await options.getWorkflowCase({
        projectId: input.projectId,
        caseId: input.caseId
      })
      caller.assertCurrent()
      assertHiveWorkbenchCompanyOwner(view.team.company, caller.accountRef)
      const selector = await options.workspaceSelector(input.projectId)
      caller.assertCurrent()
      const workspace = await options.validateWorkspace(selector)
      const assertCurrent = () => {
        caller.assertCurrent()
        workspace.assertCurrent()
        enforcement.assertCurrent()
      }
      assertCurrent()
      if (workspace.workspaceRef !== view.team.project.hiveWorkspaceRef) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      const admission = HiveWorkflowCaseRunAdmissionSchema.parse(
        await caller.request('/hive/workbench/cases/start', input)
      )
      assertCurrent()
      assertRunScope(admission.run, view)
      if (
        admission.requestId !== input.requestId ||
        admission.run.stageRef !== input.stageRef ||
        digest(admission.run.startRequest) !== digest(input) ||
        admission.payloadFingerprint !== digest({ operation: 'cases.start', input }) ||
        admission.definitionDigest !== view.definitionDigest ||
        admission.projectBindingRevision !== view.projectBindingRevision ||
        admission.workspaceSelector !== selector ||
        (admission.workflowContext &&
          digest(admission.workflowContext) !==
            digest(hiveWorkflowStageContext(view, input.stageRef))) ||
        admission.inputDigest !==
          createHash('sha256').update(JSON.stringify(admission.input)).digest('hex') ||
        (!admission.replayed && admission.input !== hiveWorkflowStagePrompt(view, input.stageRef))
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      if (admission.run.status !== 'pending') {
        return admission.run
      }
      await bindAndDispatchHiveTask({
        caller,
        issuer: options.issuer,
        workspace: { workspaceRef: workspace.workspaceRef, assertCurrent },
        companyId: admission.run.task.spaceId,
        employeeRef: admission.run.employeeRef,
        task: admission.run.task,
        workspaceSelector: selector,
        input: admission.input,
        executionMode: 'enforced_autonomous',
        executionDeadlineAt: admission.executionDeadlineAt,
        workflowContext: admission.workflowContext
      })
      assertCurrent()
      return admission.run
    }
  }
}
import { createHash } from 'node:crypto'
