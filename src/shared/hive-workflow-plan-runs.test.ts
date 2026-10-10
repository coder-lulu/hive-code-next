import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
  HiveWorkflowPlanGraphViewSchema,
  HiveWorkflowPlanGraphQuerySchema,
  HiveWorkflowPlanGraphStartSchema,
  HiveWorkflowPlanGraphRunSchema,
  HiveWorkflowPlanRunAdmissionSchema,
  HiveWorkflowPlanGraphReplySchema
} from './hive-workflow-plan-runs'
import { workflowPlanGraphFixture } from './hive-workflow-plan-runs.test-fixture'
import { workflowTestVectors } from './task-workflow/workflow.test-fixture'

describe('adopted workflow graph projections', () => {
  it('freezes a requested start duration within the original proposal maximum', () => {
    const { view } = workflowPlanGraphFixture()
    const request = {
      projectId: view.projectId,
      caseId: view.caseId,
      applicationRef: view.application.applicationRef,
      requestId: randomUUID(),
      expectedCaseRevision: 1,
      expectedProjectRevision: 1,
      draftDigest: view.application.draftDigest,
      proposalDigest: view.application.proposalDigest,
      requestedDurationMs: 1000
    }
    expect(HiveWorkflowPlanGraphStartSchema.safeParse(request).success).toBe(true)
    expect(
      HiveWorkflowPlanGraphStartSchema.safeParse({ ...request, requestedDurationMs: 999 }).success
    ).toBe(false)
    expect(
      HiveWorkflowPlanGraphStartSchema.safeParse({ ...request, requestedDurationMs: 86_400_001 })
        .success
    ).toBe(false)
    const graph = view.graph!
    graph.maxDurationMs = request.requestedDurationMs
    graph.deadlineAt = new Date(Date.parse(graph.startedAt) + graph.maxDurationMs).toISOString()
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(true)
    graph.maxDurationMs =
      view.draft.inspection.kind === 'validated'
        ? view.draft.inspection.proposal.requestedLimits.maxDurationMs + 1
        : 0
    graph.deadlineAt = new Date(Date.parse(graph.startedAt) + graph.maxDurationMs).toISOString()
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
  })
  it.each([
    'pending',
    'running',
    'cancelRequested',
    'unknown',
    'succeeded',
    'failed',
    'cancelled'
  ] as const)('requires exactly the terminal receipt state for %s', (status) => {
    const { admission } = workflowPlanGraphFixture()
    const hasResult = ['succeeded', 'failed', 'cancelled'].includes(status)
    expect(
      HiveWorkflowPlanGraphRunSchema.safeParse({ ...admission.run, status, hasResult }).success
    ).toBe(true)
    expect(
      HiveWorkflowPlanGraphRunSchema.safeParse({ ...admission.run, status, hasResult: !hasResult })
        .success
    ).toBe(false)
  })
  it('preserves cancelled receipts without inventing successful or failed output', () => {
    const { admission, view } = workflowPlanGraphFixture()
    view.runs = [{ ...admission.run, status: 'cancelled', hasResult: true }]
    view.tasks[0].latestRun = admission.run.task
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(true)
  })
  it('accepts failed not-started receipts without inventing native artifacts', () => {
    const { admission, view } = workflowPlanGraphFixture()
    view.runs = [{ ...admission.run, status: 'failed', hasResult: true }]
    view.tasks[0].latestRun = admission.run.task
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(true)
    view.runs[0].status = 'succeeded'
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
  })
  it('binds the admitted task revision to the incremented request revision', () => {
    const { admission } = workflowPlanGraphFixture()
    expect(HiveWorkflowPlanRunAdmissionSchema.safeParse(admission).success).toBe(true)
    admission.startRequest.expectedTaskRevision++
    expect(HiveWorkflowPlanRunAdmissionSchema.safeParse(admission).success).toBe(false)
  })
  it('preserves historical dispatch gaps with a separate fresh execution deadline', () => {
    const { view } = workflowPlanGraphFixture()
    expect(view.application.dispatch.reason).toBe('task_graph_dispatch_unavailable')
    expect(
      view.draft.inspection.kind === 'validated' &&
        view.draft.inspection.capabilityGaps.some((gap) => gap.capability === 'task_graph_dispatch')
    ).toBe(true)
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(true)
  })
  it.each(['scope', 'mapping', 'draft', 'deadline', 'revision', 'role'])(
    'rejects forged %s',
    (mutation) => {
      const { view } = workflowPlanGraphFixture()
      if (mutation === 'scope') {
        view.projectId = randomUUID()
      }
      if (mutation === 'mapping') {
        view.tasks[0].taskId = randomUUID()
      }
      if (mutation === 'draft') {
        view.application.draftDigest = 'f'.repeat(64)
      }
      if (mutation === 'deadline') {
        view.graph!.deadlineAt = view.graph!.startedAt
      }
      if (mutation === 'revision') {
        view.graph!.planRevision++
      }
      if (mutation === 'role') {
        view.tasks[0].role = 'ops'
      }
      expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
    }
  )
  it('admits pending runs and rejects cross-scope, unadmitted and fabricated results', () => {
    const { view, admission } = workflowPlanGraphFixture()
    view.runs.push(admission.run)
    view.tasks[0].latestRun = admission.run.task
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(true)
    view.runs[0].status = 'unknown'
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(true)
    view.runs[0].hasResult = true
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
    view.runs[0].hasResult = false
    view.runs[0].task.spaceId = 'another-company'
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
  })
  it('requires exact source run identity and allows replay without rewriting admission', () => {
    const { admission, view } = workflowPlanGraphFixture()
    admission.replayed = true
    expect(HiveWorkflowPlanRunAdmissionSchema.safeParse(admission).success).toBe(true)
    expect(
      HiveWorkflowPlanGraphReplySchema.safeParse({
        admission: {
          requestId: randomUUID(),
          payloadFingerprint: 'a'.repeat(64),
          replayed: true
        },
        view
      }).success
    ).toBe(true)
    admission.workflowContext.planExecution!.sourceTask = {
      ...admission.run.task,
      runId: randomUUID()
    }
    expect(HiveWorkflowPlanRunAdmissionSchema.safeParse(admission).success).toBe(false)
  })
  it('requires admitted producer identity and one result per successful run', () => {
    const { view, admission } = workflowPlanGraphFixture()
    const run = { ...admission.run, status: 'succeeded' as const, hasResult: true }
    view.runs = [run]
    view.tasks[0].latestRun = run.task
    const evidence = workflowTestVectors.examples.handoff
    view.outcomes = [
      {
        kind: 'workflow.plan-task-outcome',
        outcomeRef: 'graph:outcome',
        graphRef: run.graphRef,
        applicationRef: run.applicationRef,
        proposalTaskRef: run.proposalTaskRef,
        producer: {
          ...evidence.producer,
          employeeRef: run.employeeRef,
          role: run.role,
          task: run.task
        },
        status: 'succeeded',
        nativeOutcomeVersion: evidence.artifact,
        reportVersion: evidence.artifact,
        summary: 'Completed',
        codeVersion: evidence.codeVersion
      }
    ]
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(true)
    view.outcomes[0].producer.employeeRef = randomUUID()
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
    view.outcomes[0].producer.employeeRef = run.employeeRef
    view.outcomes.push({ ...view.outcomes[0], outcomeRef: 'duplicate:result' })
    expect(HiveWorkflowPlanGraphViewSchema.safeParse(view).success).toBe(false)
  })
  it('normalizes request identities and rejects additional authority fields', () => {
    const { view } = workflowPlanGraphFixture()
    const query = {
      caseId: view.caseId.toUpperCase(),
      projectId: view.projectId,
      applicationRef: view.application.applicationRef
    }
    expect(HiveWorkflowPlanGraphQuerySchema.parse(query).caseId).toBe(view.caseId)
    expect(
      HiveWorkflowPlanGraphQuerySchema.safeParse({ ...query, authorizationRef: 'grant' }).success
    ).toBe(false)
  })
  it('bundles for browsers without Node authority or crypto imports', async () => {
    const result = await build({
      entryPoints: ['src/shared/hive-workflow-plan-runs.ts'],
      bundle: true,
      platform: 'browser',
      write: false,
      logLevel: 'silent'
    })
    expect(result.outputFiles[0].text).not.toContain('node:crypto')
  })
})
