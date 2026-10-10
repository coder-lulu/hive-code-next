import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { workflowPlanGraphFixture } from './hive-workflow-plan-runs.test-fixture'
import { HiveWorkflowPlanGraphViewSchema } from './hive-workflow-plan-runs'

function pausedAdmissionGraph() {
  const { view, admission, source } = workflowPlanGraphFixture()
  const run = { ...admission.run, status: 'succeeded' as const, hasResult: true }
  view.runs = [run]
  view.tasks[0].latestRun = run.task
  view.outcomes = [
    {
      kind: 'workflow.plan-task-outcome',
      outcomeRef: 'result:success',
      graphRef: run.graphRef,
      applicationRef: run.applicationRef,
      proposalTaskRef: run.proposalTaskRef,
      producer: {
        ...source.draft.producer,
        employeeRef: run.employeeRef,
        role: run.role,
        task: run.task
      },
      status: 'succeeded',
      nativeOutcomeVersion: source.draft.outcomeVersion,
      reportVersion: source.draft.outcomeVersion,
      summary: 'Synthetic completed predecessor'
    }
  ]
  view.graph!.status = 'paused'
  view.graph!.pauseCause = {
    kind: 'admission_unavailable',
    causeRunId: run.task.runId,
    proposalTaskRef: run.proposalTaskRef,
    code: 'FORBIDDEN',
    reason: 'authorization_unavailable'
  }
  return view
}

describe('admission pause source evidence', () => {
  it('accepts a typed pause tied to a succeeded admitted predecessor and mapped target', () => {
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(pausedAdmissionGraph()).success).toBe(true)
  })
  it.each([
    'forged-run',
    'failed-run',
    'missing-outcome',
    'foreign-graph',
    'foreign-task',
    'not-paused'
  ])('rejects %s pause evidence', (mutation) => {
    const view = pausedAdmissionGraph()
    if (mutation === 'forged-run') {
      view.graph!.pauseCause!.causeRunId = randomUUID()
    }
    if (mutation === 'failed-run') {
      view.runs[0].status = 'failed'
      view.outcomes[0].status = 'failed'
    }
    if (mutation === 'missing-outcome') {
      view.outcomes = []
    }
    if (mutation === 'foreign-graph') {
      view.runs[0].graphRef = randomUUID()
    }
    if (mutation === 'foreign-task') {
      view.graph!.pauseCause!.proposalTaskRef = 'not-adopted'
    }
    if (mutation === 'not-paused') {
      view.graph!.status = 'running'
    }
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
  })
  it('preserves failed-run pauses without making them admission-resumable', () => {
    const view = pausedAdmissionGraph()
    delete view.graph!.pauseCause
    view.runs[0].status = 'failed'
    view.outcomes = []
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(true)
  })
  it('rejects unbounded raw server reason strings', () => {
    const view = pausedAdmissionGraph()
    const cause = { ...view.graph!.pauseCause, reason: 'raw server detail' }
    expect(
      HiveWorkflowPlanGraphViewSchema.safeParse({
        ...view,
        graph: { ...view.graph, pauseCause: cause }
      }).success
    ).toBe(false)
  })
})
