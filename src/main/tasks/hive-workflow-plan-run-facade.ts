import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import {
  HiveWorkflowPlanGraphQuerySchema,
  HiveWorkflowPlanGraphStartSchema,
  HiveWorkflowPlanGraphMutationSchema,
  HiveWorkflowPlanGraphRetrySchema,
  HiveWorkflowPlanGraphViewSchema,
  HiveWorkflowPlanGraphReplySchema,
  type HiveWorkflowPlanGraphQuery,
  type HiveWorkflowPlanRunsApi
} from '../../shared/hive-workflow-plan-runs'
import { assertHiveWorkbenchCompanyOwner } from './hive-team-workbench-facade'
import { assertWorkflowPlanGraphSource } from './hive-workflow-plan-graph-source'
import {
  createWorkflowPlanRunPreparer,
  type WorkflowPlanRunPreparerOptions
} from './hive-workflow-plan-run-preparation'
import { refuseTaskExecution } from './task-execution-error'

export function createHiveWorkflowPlanRunFacade(options: WorkflowPlanRunPreparerOptions) {
  const source = async (query: HiveWorkflowPlanGraphQuery) => {
    const caller = await options.context()
    const original = await options.getWorkflowCase({
      projectId: query.projectId,
      caseId: query.caseId
    })
    caller.assertCurrent()
    assertHiveWorkbenchCompanyOwner(original.team.company, caller.accountRef)
    if (original.id !== query.caseId || original.binding.scope.projectRef !== query.projectId) {
      return refuseTaskExecution('FORBIDDEN')
    }
    return { caller, original }
  }
  const mutate = async (
    input:
      | Parameters<HiveWorkflowPlanRunsApi['startWorkflowPlanGraph']>[0]
      | Parameters<HiveWorkflowPlanRunsApi['cancelWorkflowPlanGraph']>[0]
      | Parameters<HiveWorkflowPlanRunsApi['retryWorkflowPlanTask']>[0],
    operation: 'start' | 'cancel' | 'retry' | 'resume'
  ) => {
    const { caller, original } = await source(input)
    let guard = () => caller.assertCurrent()
    if (operation !== 'cancel') {
      if (!options.enforcement) {
        return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
      }
      const enforcement = await options.enforcement()
      caller.assertCurrent()
      const team = await options.getTeam(input.projectId)
      assertHiveWorkbenchCompanyOwner(team.company.binding, caller.accountRef)
      const selector = team.project.workspaceSelector
      caller.assertCurrent()
      const workspace = await options.validateWorkspace(selector)
      guard = () => {
        caller.assertCurrent()
        workspace.assertCurrent()
        enforcement.assertCurrent()
      }
      guard()
      if (
        team.project.id !== input.projectId ||
        team.project.binding.bindingRevision !== original.projectBindingRevision ||
        team.project.binding.hiveWorkspaceRef !== workspace.workspaceRef ||
        workspace.workspaceRef !== original.team.project.hiveWorkspaceRef
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
    }
    guard()
    const before = HiveWorkflowPlanGraphViewSchema.parse(
      await caller.request('/hive/workbench/plans/graph-read', {
        projectId: input.projectId,
        caseId: input.caseId,
        applicationRef: input.applicationRef
      })
    )
    guard()
    assertWorkflowPlanGraphSource(before, input, original)
    if (
      'draftDigest' in input &&
      (before.application.draftDigest !== input.draftDigest ||
        before.application.proposalDigest !== input.proposalDigest ||
        before.application.projectBindingRevision !== input.expectedProjectRevision)
    ) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    const reply = HiveWorkflowPlanGraphReplySchema.parse(
      await caller.request(`/hive/workbench/plans/graph-${operation}`, input)
    )
    guard()
    assertWorkflowPlanGraphSource(reply.view, input, original)
    if (
      reply.admission.requestId !== input.requestId ||
      reply.admission.payloadFingerprint !==
        digest({ operation: `plans.graph.${operation}`, input }) ||
      !reply.view.graph ||
      ('graphRef' in input && reply.view.graph.graphRef !== input.graphRef) ||
      ('draftDigest' in input &&
        (reply.view.graph.draftDigest !== input.draftDigest ||
          reply.view.graph.proposalDigest !== input.proposalDigest ||
          reply.view.graph.projectBindingRevision !== input.expectedProjectRevision ||
          reply.view.graph.maxDurationMs !== input.requestedDurationMs))
    ) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    return reply
  }
  const facade: HiveWorkflowPlanRunsApi = {
    async getWorkflowPlanGraph(raw) {
      const query = HiveWorkflowPlanGraphQuerySchema.parse(raw)
      const { caller, original } = await source(query)
      const view = HiveWorkflowPlanGraphViewSchema.parse(
        await caller.request('/hive/workbench/plans/graph-read', query)
      )
      caller.assertCurrent()
      assertWorkflowPlanGraphSource(view, query, original)
      return view
    },
    startWorkflowPlanGraph: (raw) => mutate(HiveWorkflowPlanGraphStartSchema.parse(raw), 'start'),
    cancelWorkflowPlanGraph: (raw) =>
      mutate(HiveWorkflowPlanGraphMutationSchema.parse(raw), 'cancel'),
    retryWorkflowPlanTask: (raw) => mutate(HiveWorkflowPlanGraphRetrySchema.parse(raw), 'retry'),
    resumeWorkflowPlanGraph: (raw) =>
      mutate(HiveWorkflowPlanGraphMutationSchema.parse(raw), 'resume')
  }
  return { facade, preparePlanRun: createWorkflowPlanRunPreparer(options) }
}
