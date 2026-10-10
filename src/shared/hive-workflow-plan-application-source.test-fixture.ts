import { randomUUID } from 'node:crypto'
import { workflowPlanApplicationFixture } from './hive-workflow-plan-application.test-fixture'
import { HiveWorkflowCaseViewSchema } from './hive-workflow-cases'
import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'
import { inspectWorkflowPlanProposal } from './task-workflow/workflow-plan-validation'
import { compareWorkflowPlans } from './task-workflow/workflow-plan-diff'

export function workflowPlanHistoricalApplicationFixture() {
  const f = workflowPlanApplicationFixture()
  f.proposal.tasks.push({
    taskRef: 'test-followup',
    title: 'Independent test',
    requestedRole: 'tester',
    outputKind: 'test_report',
    dependsOn: [f.proposal.tasks[0].taskRef],
    acceptance: ['Tests pass'],
    maxAttempts: 1
  })
  f.draft.inspection = inspectWorkflowPlanProposal(f.proposal, f.draft.intent.facts)
  f.receipt.draftDigest = digest(f.draft)
  f.receipt.proposalDigest = digest(f.proposal)
  f.receipt.createdTaskRefs.push({
    proposalTaskRef: 'test-followup',
    taskId: randomUUID(),
    employeeRef: f.caseView.team.employees.find((employee) => employee.role === 'tester')!
      .employeeRef,
    dependsOnTaskIds: [f.receipt.createdTaskRefs[0].taskId]
  })
  f.view.taskStates.push({
    taskId: f.receipt.createdTaskRefs[1].taskId,
    status: 'blocked',
    taskRevision: 0
  })
  const next = structuredClone(f.draft)
  next.draftRef = 'new-draft'
  next.intent.intentRef = 'new-intent'
  next.intent.facts.planRevision = 2
  next.intent.sourceTask.runId = randomUUID()
  next.producer.task = structuredClone(next.intent.sourceTask)
  next.inspection = inspectWorkflowPlanProposal(
    { ...f.proposal, planRevision: 2 },
    next.intent.facts
  )
  f.caseView.planDrafts.push(next)
  f.caseView.planningIntent = next.intent
  HiveWorkflowCaseViewSchema.parse(f.caseView)
  f.view.draft = next
  f.view.baseline = f.draft
  f.view.diff = compareWorkflowPlans({ ...f.proposal, planRevision: 2 }, f.proposal)
  f.view.eligibility = { available: false, reason: 'plan_replacement_unavailable' }
  f.view.application = f.receipt
  const query = { projectId: f.input.projectId, caseId: f.input.caseId, draftRef: next.draftRef }
  return { ...f, next, query }
}
