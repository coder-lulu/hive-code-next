import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { HiveWorkflowPlanGraphViewSchema } from './hive-workflow-plan-runs'
import { workflowPlanGraphFixture } from './hive-workflow-plan-runs.test-fixture'
import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'
import { inspectWorkflowPlanProposal } from './task-workflow/workflow-plan-validation'

function completedGraph(coding = false, testers = 1) {
  const { view, source, admission } = workflowPlanGraphFixture()
  if (coding) {
    source.proposal.tasks = [
      {
        ...source.proposal.tasks[0],
        taskRef: 'developer',
        requestedRole: 'developer',
        outputKind: 'code'
      },
      ...Array.from({ length: testers }, (_, index) => ({
        ...source.proposal.tasks[0],
        taskRef: `tester-${index}`,
        requestedRole: 'tester' as const,
        outputKind: 'test_report' as const,
        dependsOn: ['developer']
      }))
    ]
    view.draft.inspection = inspectWorkflowPlanProposal(source.proposal, view.draft.intent.facts)
    view.application.draftDigest = digest(view.draft)
    view.application.proposalDigest = digest(source.proposal)
    const developerId = randomUUID()
    view.application.createdTaskRefs = source.proposal.tasks.map((task) => ({
      proposalTaskRef: task.taskRef,
      taskId: task.requestedRole === 'developer' ? developerId : randomUUID(),
      employeeRef: source.caseView.team.employees.find(
        (employee) => employee.role === task.requestedRole
      )!.employeeRef,
      dependsOnTaskIds: task.dependsOn.length ? [developerId] : []
    }))
    view.tasks = view.application.createdTaskRefs.map((mapping, index) => ({
      ...view.tasks[0],
      proposalTaskRef: mapping.proposalTaskRef,
      taskId: mapping.taskId,
      employeeRef: mapping.employeeRef,
      role: source.proposal.tasks[index].requestedRole
    }))
    view.graph!.draftDigest = view.application.draftDigest
    view.graph!.proposalDigest = view.application.proposalDigest
  }
  view.graph!.status = 'done'
  const artifact = { artifactRef: 'developer-report', artifactRevision: 1, digest: 'a'.repeat(64) }
  const codeVersion = { kind: 'snapshot' as const, snapshot: artifact, treeDigest: 'b'.repeat(64) }
  for (const [index, task] of view.tasks.entries()) {
    const taskRef = { ...admission.run.task, taskId: task.taskId, runId: randomUUID() }
    task.latestRun = taskRef
    task.status = 'done'
    view.runs.push({
      ...admission.run,
      proposalTaskRef: task.proposalTaskRef,
      employeeRef: task.employeeRef,
      role: task.role,
      task: taskRef,
      status: 'succeeded',
      hasResult: true
    })
    const producer = {
      ...source.draft.producer,
      employeeRef: task.employeeRef,
      role: task.role,
      task: taskRef,
      executionId: `execution-${index}`,
      sessionRef: `session-${index}`,
      executionWorkspaceRef: `workspace-${index}`,
      workspaceExecutionClaimRef: `claim-${index}`
    }
    view.outcomes.push({
      kind: 'workflow.plan-task-outcome',
      outcomeRef: `outcome-${index}`,
      graphRef: view.graph!.graphRef,
      applicationRef: view.application.applicationRef,
      proposalTaskRef: task.proposalTaskRef,
      producer,
      status: 'succeeded',
      nativeOutcomeVersion: artifact,
      reportVersion: artifact,
      summary: 'Synthetic completed task',
      ...(coding ? { codeVersion } : {}),
      ...(task.role === 'tester'
        ? {
            review: {
              contractVersion: 1 as const,
              kind: 'workflow.review' as const,
              reviewRef: `review-${index}`,
              binding: view.application.binding,
              stageRef: task.proposalTaskRef,
              subjectHandoffRef: 'outcome-0',
              artifact,
              codeVersion,
              reviewer: { ...producer, role: 'tester' as const },
              decision: 'approved' as const,
              testReport: { ...artifact, artifactRef: `test-report-${index}` }
            }
          }
        : {})
    })
  }
  return view
}

describe('source-bound graph completion', () => {
  it('rejects forged done with untouched tasks and no admitted outcomes', () => {
    const { view } = workflowPlanGraphFixture()
    view.graph!.status = 'done'
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
  })
  it('accepts completed product-only graphs without introducing a coding review', () => {
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(completedGraph()).success).toBe(true)
  })
  it('accepts completed coding only with one fully independent approved review', () => {
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(completedGraph(true)).success).toBe(true)
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(completedGraph(true, 2)).success).toBe(false)
  })
  it.each([
    'missing',
    'rejected',
    'same-session',
    'same-workspace',
    'same-report',
    'wrong-version'
  ])('rejects %s review evidence', (mutation) => {
    const view = completedGraph(true)
    const outcome = view.outcomes[1]
    if (mutation === 'missing') {
      delete outcome.review
    }
    if (mutation === 'rejected') {
      outcome.review!.decision = 'rejected'
    }
    if (mutation === 'same-session') {
      outcome.producer.sessionRef = view.outcomes[0].producer.sessionRef
      outcome.review!.reviewer.sessionRef = outcome.producer.sessionRef
    }
    if (mutation === 'same-workspace') {
      outcome.producer.executionWorkspaceRef = view.outcomes[0].producer.executionWorkspaceRef
      outcome.review!.reviewer.executionWorkspaceRef = outcome.producer.executionWorkspaceRef
    }
    if (mutation === 'same-report') {
      outcome.review!.testReport = view.outcomes[0].reportVersion
    }
    if (mutation === 'wrong-version') {
      outcome.review!.codeVersion = { ...outcome.review!.codeVersion, treeDigest: 'c'.repeat(64) }
    }
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
  })
  it('rejects unsettled cancellation and preserves prior successful tasks', () => {
    const view = completedGraph()
    view.graph!.status = 'cancelled'
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(true)
    view.tasks[0].status = 'todo'
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
    view.tasks[0].status = 'cancelled'
    view.runs[0].status = 'unknown'
    view.runs[0].hasResult = false
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
  })
})
