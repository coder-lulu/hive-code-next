import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { workflowPlanApplicationMatchesDraft } from '../../shared/hive-workflow-plan-application-source'
import type { HiveWorkflowCasesApi, HiveWorkflowCaseView } from '../../shared/hive-workflow-cases'
import {
  HiveWorkflowPlanQuerySchema,
  HiveWorkflowPlanApplySchema,
  HiveWorkflowPlanApplicationViewSchema,
  HiveWorkflowPlanApplyReplySchema,
  type HiveWorkflowPlanApplicationView,
  type HiveWorkflowPlanQuery,
  type HiveWorkflowPlansApi
} from '../../shared/hive-workflow-plan-application'
import {
  assertHiveWorkbenchCompanyOwner,
  type HiveTaskRequestContext
} from './hive-team-workbench-facade'
import { refuseTaskExecution } from './task-execution-error'

function assertPlanSource(
  value: HiveWorkflowPlanApplicationView,
  query: HiveWorkflowPlanQuery,
  original: HiveWorkflowCaseView
) {
  const draft = original.planDrafts.find((item) => item.draftRef === query.draftRef)
  const baseline = value.baseline
  if (
    value.caseId !== query.caseId ||
    value.projectId !== query.projectId ||
    value.caseRevision < original.revision ||
    !draft ||
    digest(value.draft) !== digest(draft) ||
    (baseline !== null && !original.planDrafts.some((item) => digest(item) === digest(baseline)))
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  const application = value.application
  if (!application) {
    return
  }
  const source = original.planDrafts.find((item) => item.draftRef === application.draftRef)
  if (
    !source ||
    !workflowPlanApplicationMatchesDraft(application, source) ||
    source.inspection.kind !== 'validated' ||
    digest(source) !== application.draftDigest ||
    digest(source.inspection.proposal) !== application.proposalDigest ||
    digest(application.binding) !== digest(original.binding) ||
    application.parentTaskRef !== original.originTaskId ||
    application.projectBindingRevision !== original.projectBindingRevision ||
    application.createdTaskRefs.some((item) => {
      const task =
        source.inspection.kind === 'validated'
          ? source.inspection.proposal.tasks.find((task) => task.taskRef === item.proposalTaskRef)
          : undefined
      return (
        !task ||
        !original.team.employees.some(
          (employee) =>
            employee.role === task.requestedRole && employee.employeeRef === item.employeeRef
        )
      )
    })
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
}

/** Materializes business rows only; execution still requires its own admission. */
export function createHiveWorkflowPlanApplicationFacade(options: {
  context(): Promise<HiveTaskRequestContext>
  getWorkflowCase: HiveWorkflowCasesApi['getWorkflowCase']
}): HiveWorkflowPlansApi {
  const source = async (caller: HiveTaskRequestContext, query: HiveWorkflowPlanQuery) => {
    caller.assertCurrent()
    const view = await options.getWorkflowCase({ projectId: query.projectId, caseId: query.caseId })
    caller.assertCurrent()
    assertHiveWorkbenchCompanyOwner(view.team.company, caller.accountRef)
    if (
      view.id !== query.caseId ||
      view.binding.scope.projectRef !== query.projectId ||
      !view.planDrafts.some((item) => item.draftRef === query.draftRef)
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
    return view
  }
  return {
    async getWorkflowPlanApplication(raw) {
      const query = HiveWorkflowPlanQuerySchema.parse(raw)
      const caller = await options.context()
      const original = await source(caller, query)
      const value = HiveWorkflowPlanApplicationViewSchema.parse(
        await caller.request('/hive/workbench/plans/read', query)
      )
      caller.assertCurrent()
      assertPlanSource(value, query, original)
      return value
    },
    async applyWorkflowPlan(raw) {
      const input = HiveWorkflowPlanApplySchema.parse(raw)
      const caller = await options.context()
      const original = await source(caller, input)
      const draft = original.planDrafts.find((item) => item.draftRef === input.draftRef)
      if (
        !draft ||
        draft.intent.facts.planRevision !== input.planRevision ||
        digest(draft) !== input.draftDigest
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      const reply = HiveWorkflowPlanApplyReplySchema.parse(
        await caller.request('/hive/workbench/plans/apply', input)
      )
      caller.assertCurrent()
      assertPlanSource(reply.view, input, original)
      const application = reply.view.application
      if (
        reply.admission.requestId !== input.requestId ||
        reply.admission.payloadFingerprint !== digest({ operation: 'plans.apply', input }) ||
        !application ||
        application.draftRef !== input.draftRef ||
        application.planRevision !== input.planRevision ||
        application.draftDigest !== input.draftDigest ||
        application.projectBindingRevision !== input.expectedProjectRevision ||
        (!reply.admission.replayed &&
          (application.requestId !== input.requestId ||
            reply.view.caseRevision !== input.expectedCaseRevision))
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return reply
    }
  }
}
