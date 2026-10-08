import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import type { HiveTeamWorkbenchApi, HiveWorkbenchTeam } from '../../shared/hive-team-workbench'
import type { HiveTaskWorkflowsApi } from '../../shared/hive-task-workflows'
import {
  HiveWorkflowCaseCreateSchema,
  HiveWorkflowCaseCreateReplySchema,
  HiveWorkflowCaseListQuerySchema,
  HiveWorkflowCasePageSchema,
  HiveWorkflowCaseReadQuerySchema,
  HiveWorkflowCaseViewSchema,
  type HiveWorkflowCasesApi,
  type HiveWorkflowCaseSummary
} from '../../shared/hive-workflow-cases'
import { WorkflowTeamBindingSchema } from '../../shared/task-workflow/workflow-bindings'
import {
  assertHiveWorkbenchCompanyOwner,
  type HiveTaskRequestContext,
  type HiveTaskWorkspaceProof
} from './hive-team-workbench-facade'
import { refuseTaskExecution } from './task-execution-error'

export function createHiveWorkflowCaseFacade(options: {
  context(): Promise<HiveTaskRequestContext>
  getTeam: HiveTeamWorkbenchApi['getTeam']
  getWorkflow: HiveTaskWorkflowsApi['getWorkflow']
  validateWorkspace(selector: string): Promise<HiveTaskWorkspaceProof>
  enforcement?: () => Promise<{ assertCurrent(): void }>
}): HiveWorkflowCasesApi {
  const availability = async (
    caller: HiveTaskRequestContext,
    view: ReturnType<typeof HiveWorkflowCaseViewSchema.parse>
  ) => {
    if (options.enforcement) {
      try {
        const proof = await options.enforcement()
        caller.assertCurrent()
        proof.assertCurrent()
        return HiveWorkflowCaseViewSchema.parse({
          ...view,
          executionAvailability: { available: true, mode: 'docker_linux' }
        })
      } catch {
        caller.assertCurrent()
      }
    }
    return HiveWorkflowCaseViewSchema.parse({
      ...view,
      executionAvailability: { available: false, reason: 'EXECUTION_ISOLATION_UNAVAILABLE' }
    })
  }
  const projectTeam = async (caller: HiveTaskRequestContext, projectId: string) => {
    caller.assertCurrent()
    const team = await options.getTeam(projectId)
    caller.assertCurrent()
    if (team.project.id !== projectId) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    return team
  }
  const assertScope = (view: Pick<HiveWorkflowCaseSummary, 'binding'>, team: HiveWorkbenchTeam) => {
    if (
      view.binding.scope.companyRef !== team.company.id ||
      view.binding.scope.projectRef !== team.project.id
    ) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
  }
  const request = async (caller: HiveTaskRequestContext, path: string, body: unknown) => {
    caller.assertCurrent()
    const value = await caller.request(path, body)
    caller.assertCurrent()
    return value
  }
  return {
    async listWorkflowCases(rawQuery) {
      const query = HiveWorkflowCaseListQuerySchema.parse(rawQuery)
      const caller = await options.context()
      const team = await projectTeam(caller, query.projectId)
      const page = HiveWorkflowCasePageSchema.parse(
        await request(caller, '/hive/workbench/cases/list', query)
      )
      let previous = query.after
      for (const item of page.items) {
        assertScope(item, team)
        const itemId = item.id.toLowerCase()
        if (
          (query.workflowId !== undefined &&
            item.binding.workflowRef.toLowerCase() !== query.workflowId) ||
          (previous !== undefined && itemId <= previous)
        ) {
          return refuseTaskExecution('REVISION_CONFLICT')
        }
        previous = itemId
      }
      if (
        page.items.length > query.limit ||
        (page.nextCursor !== null &&
          page.nextCursor.toLowerCase() !== page.items.at(-1)?.id.toLowerCase())
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return page
    },
    async getWorkflowCase(rawQuery) {
      const query = HiveWorkflowCaseReadQuerySchema.parse(rawQuery)
      const caller = await options.context()
      const team = await projectTeam(caller, query.projectId)
      const view = HiveWorkflowCaseViewSchema.parse(
        await request(caller, '/hive/workbench/cases/read', query)
      )
      assertScope(view, team)
      assertHiveWorkbenchCompanyOwner(view.team.company, caller.accountRef)
      if (view.id.toLowerCase() !== query.caseId) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return availability(caller, view)
    },
    async createWorkflowCase(rawInput) {
      const input = HiveWorkflowCaseCreateSchema.parse(rawInput)
      const caller = await options.context()
      const team = await projectTeam(caller, input.projectId)
      const currentBinding = team.project.binding.bindingRevision === input.expectedProjectRevision
      if (currentBinding && team.employees.length !== 4) {
        return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
      }
      const workflow = await options.getWorkflow({
        projectId: input.projectId,
        workflowId: input.workflowId,
        revision: input.workflowRevision
      })
      caller.assertCurrent()
      if (workflow.definitionDigest !== input.definitionDigest) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      const workspace = await options.validateWorkspace(team.project.workspaceSelector)
      workspace.assertCurrent()
      caller.assertCurrent()
      if (workspace.workspaceRef !== team.project.binding.hiveWorkspaceRef) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      // The service may recover an existing request across a later team revision; new admission still checks it.
      const teamBinding = currentBinding
        ? WorkflowTeamBindingSchema.parse({
            contractVersion: 1,
            kind: 'workflow.team-binding',
            company: team.company.binding,
            project: team.project.binding,
            employees: team.employees.map((employee) => employee.binding)
          })
        : null
      const rawView = await request(caller, '/hive/workbench/cases/create', input)
      workspace.assertCurrent()
      caller.assertCurrent()
      const { admission, view } = HiveWorkflowCaseCreateReplySchema.parse(rawView)
      assertScope(view, team)
      assertHiveWorkbenchCompanyOwner(view.team.company, caller.accountRef)
      if (
        admission.requestId.toLowerCase() !== input.requestId ||
        admission.payloadFingerprint !==
          canonicalAgentSessionDigest({ operation: 'cases.create', input }) ||
        view.binding.workflowRef !== input.workflowId ||
        view.binding.workflowRevision !== input.workflowRevision ||
        view.definitionDigest !== input.definitionDigest ||
        view.projectBindingRevision !== input.expectedProjectRevision ||
        (!admission.replayed &&
          (view.title !== input.title || view.requirement !== input.requirement)) ||
        (teamBinding !== null &&
          canonicalAgentSessionDigest(view.team) !== canonicalAgentSessionDigest(teamBinding))
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return availability(caller, view)
    }
  }
}
