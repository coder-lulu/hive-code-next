import { randomUUID } from 'node:crypto'
import { workflowCaseFixture } from './hive-workflow-cases.test-fixture'
import { HiveWorkflowCaseViewSchema } from './hive-workflow-cases'
import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'
import { workflowPlanDraftFixture } from './task-workflow/workflow-plan-draft.test-fixture'
import { inspectWorkflowPlanProposal } from './task-workflow/workflow-plan-validation'
import { compareWorkflowPlans } from './task-workflow/workflow-plan-diff'
import {
  HiveWorkflowPlanApplicationViewSchema,
  HiveWorkflowPlanApplySchema,
  type HiveWorkflowPlanApplicationReceipt
} from './hive-workflow-plan-application'

export function workflowPlanApplicationFixture() {
  const original = workflowCaseFixture()
  const caseView = original.view
  const draft = workflowPlanDraftFixture()
  const product = caseView.stageTasks.find((task) => task.role === 'product')!
  draft.intent.sourceTask = {
    spaceId: caseView.binding.scope.companyRef,
    taskId: product.taskId,
    runId: randomUUID(),
    attempt: 1,
    taskRevision: '0'
  }
  draft.intent.employeeRef = product.employeeRef
  draft.intent.stageRef = product.stageRef
  draft.intent.facts = {
    ...draft.intent.facts,
    binding: structuredClone(caseView.binding),
    goalRef: caseView.originTaskId,
    definitionDigest: caseView.definitionDigest
  }
  draft.producer.employeeRef = product.employeeRef
  draft.producer.task = structuredClone(draft.intent.sourceTask)
  if (draft.inspection.kind !== 'validated') {
    throw new Error('invalid fixture')
  }
  const proposal = draft.inspection.proposal
  proposal.binding = structuredClone(caseView.binding)
  proposal.goalRef = caseView.originTaskId
  proposal.definitionDigest = caseView.definitionDigest
  draft.inspection = inspectWorkflowPlanProposal(proposal, draft.intent.facts)
  caseView.planDrafts = [draft]
  caseView.planningIntent = draft.intent
  HiveWorkflowCaseViewSchema.parse(caseView)
  const input = HiveWorkflowPlanApplySchema.parse({
    projectId: caseView.binding.scope.projectRef,
    caseId: caseView.id,
    draftRef: draft.draftRef,
    requestId: randomUUID(),
    expectedCaseRevision: caseView.revision,
    expectedProjectRevision: caseView.projectBindingRevision,
    planRevision: proposal.planRevision,
    draftDigest: digest(draft)
  })
  const createdTaskRefs: HiveWorkflowPlanApplicationReceipt['createdTaskRefs'] = proposal.tasks.map(
    (task) => ({
      proposalTaskRef: task.taskRef,
      taskId: randomUUID(),
      employeeRef: caseView.team.employees.find((employee) => employee.role === task.requestedRole)!
        .employeeRef,
      dependsOnTaskIds: []
    })
  )
  for (const [index, task] of proposal.tasks.entries()) {
    createdTaskRefs[index].dependsOnTaskIds = task.dependsOn.map(
      (ref) => createdTaskRefs.find((mapped) => mapped.proposalTaskRef === ref)!.taskId
    )
  }
  const receipt: HiveWorkflowPlanApplicationReceipt = {
    contractVersion: 1,
    kind: 'workflow.plan-application',
    applicationRef: randomUUID(),
    requestId: input.requestId,
    binding: caseView.binding,
    planRevision: proposal.planRevision,
    draftRef: draft.draftRef,
    draftDigest: digest(draft),
    proposalDigest: digest(proposal),
    projectBindingRevision: caseView.projectBindingRevision,
    parentTaskRef: caseView.originTaskId,
    createdTaskRefs,
    appliedAt: '2026-10-10T00:00:00.000Z',
    dispatch: { available: false, reason: 'task_graph_dispatch_unavailable' }
  }
  const view = HiveWorkflowPlanApplicationViewSchema.parse({
    caseId: caseView.id,
    projectId: input.projectId,
    caseRevision: caseView.revision,
    currentProjectBindingRevision: caseView.projectBindingRevision,
    draft,
    baseline: null,
    diff: compareWorkflowPlans(proposal, null),
    eligibility: { available: false, reason: 'already_applied' },
    application: receipt,
    taskStates: createdTaskRefs.map((task) => ({
      taskId: task.taskId,
      status: 'blocked',
      taskRevision: 0
    }))
  })
  return { ...original, caseView, draft, proposal, receipt, view, input }
}
