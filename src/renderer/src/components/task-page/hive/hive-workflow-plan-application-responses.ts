import { structuredAgentSessionDigest as digest } from '../../../../../shared/structured-agent-session-mutation'
import { workflowPlanApplicationMatchesDraft } from '../../../../../shared/hive-workflow-plan-application-source'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { WorkflowPlanDraft } from '../../../../../shared/task-workflow/workflow-plan-draft'
import {
  HiveWorkflowPlanApplicationViewSchema,
  HiveWorkflowPlanApplyReplySchema,
  type HiveWorkflowPlanApply
} from '../../../../../shared/hive-workflow-plan-application'

export function readWorkflowPlanApplication(
  raw: unknown,
  view: HiveWorkflowCaseView,
  draft: WorkflowPlanDraft
) {
  const page = HiveWorkflowPlanApplicationViewSchema.parse(raw)
  const baseline = page.baseline
  if (
    page.caseId !== view.id ||
    page.projectId !== view.binding.scope.projectRef ||
    page.caseRevision < view.revision ||
    digest(page.draft) !== digest(draft) ||
    (baseline && !view.planDrafts.some((item) => digest(item) === digest(baseline)))
  ) {
    throw new Error('REVISION_CONFLICT')
  }
  const application = page.application
  if (application) {
    const original = view.planDrafts.find((item) => item.draftRef === application.draftRef)
    if (
      !original ||
      !workflowPlanApplicationMatchesDraft(application, original) ||
      digest(original) !== application.draftDigest ||
      digest(application.binding) !== digest(view.binding) ||
      application.parentTaskRef !== view.originTaskId ||
      application.projectBindingRevision !== view.projectBindingRevision ||
      original.inspection.kind !== 'validated' ||
      digest(original.inspection.proposal) !== application.proposalDigest ||
      application.createdTaskRefs.some((mapping) => {
        const task =
          original.inspection.kind === 'validated'
            ? original.inspection.proposal.tasks.find(
                (item) => item.taskRef === mapping.proposalTaskRef
              )
            : undefined
        return (
          !task ||
          !view.team.employees.some(
            (employee) =>
              employee.role === task.requestedRole && employee.employeeRef === mapping.employeeRef
          )
        )
      })
    ) {
      throw new Error('REVISION_CONFLICT')
    }
  }
  return page
}

export function readWorkflowPlanApplyReply(
  raw: unknown,
  input: HiveWorkflowPlanApply,
  view: HiveWorkflowCaseView,
  draft: WorkflowPlanDraft
) {
  const reply = HiveWorkflowPlanApplyReplySchema.parse(raw)
  const page = readWorkflowPlanApplication(reply.view, view, draft)
  const receipt = page.application
  if (
    reply.admission.requestId !== input.requestId ||
    reply.admission.payloadFingerprint !== digest({ operation: 'plans.apply', input }) ||
    !receipt ||
    receipt.draftRef !== input.draftRef ||
    receipt.draftDigest !== input.draftDigest ||
    receipt.planRevision !== input.planRevision ||
    receipt.projectBindingRevision !== input.expectedProjectRevision ||
    (!reply.admission.replayed && page.caseRevision !== input.expectedCaseRevision)
  ) {
    throw new Error('REVISION_CONFLICT')
  }
  return page
}
