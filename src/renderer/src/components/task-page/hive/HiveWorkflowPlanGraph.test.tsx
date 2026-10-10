// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import { workflowPlanGraphFixture } from '../../../../../shared/hive-workflow-plan-runs.test-fixture'
import { structuredAgentSessionDigest as digest } from '../../../../../shared/structured-agent-session-mutation'
import { workflowTestVectors } from '../../../../../shared/task-workflow/workflow.test-fixture'
import { inspectWorkflowPlanProposal } from '../../../../../shared/task-workflow/workflow-plan-validation'
import { HiveWorkflowPlanGraph } from './HiveWorkflowPlanGraph'
import {
  deferredWorkbenchValue,
  workbenchAccountBoundaryStates,
  workbenchAccountState
} from './hive-workbench.test-fixtures'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const api = {
  getWorkflowPlanGraph: vi.fn(),
  startWorkflowPlanGraph: vi.fn(),
  cancelWorkflowPlanGraph: vi.fn(),
  retryWorkflowPlanTask: vi.fn(),
  resumeWorkflowPlanGraph: vi.fn(),
  artifact: vi.fn()
}
const listeners = new Set<(state: HiveAccountState) => void>()
let root: Root, container: HTMLDivElement, f: ReturnType<typeof workflowPlanGraphFixture>
function available() {
  return {
    ...f.view,
    graph: null,
    tasks: f.view.tasks.map((task) => ({ ...task, status: 'blocked' }))
  }
}
function button(key: string) {
  const target = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.endsWith(key)
  )
  if (!target) {
    throw new Error(`Missing ${key}`)
  }
  return target
}
async function click(key: string) {
  await act(async () => button(key).click())
}
async function mount() {
  await act(async () =>
    root.render(
      <HiveWorkflowPlanGraph original={f.source.caseView} application={f.source.receipt} />
    )
  )
}
function withReport() {
  const page = structuredClone(f.view),
    run = f.admission.run,
    evidence = workflowTestVectors.examples.handoff
  page.tasks[0].latestRun = run.task
  page.tasks[0].status = 'done'
  page.runs = [{ ...run, status: 'succeeded', hasResult: true }]
  page.outcomes = [
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
      summary: 'Actual task report',
      codeVersion: evidence.codeVersion
    }
  ]
  return page
}
function allowSecondAttempt() {
  f.source.proposal.tasks[0].maxAttempts = 2
  f.source.draft.inspection = inspectWorkflowPlanProposal(
    f.source.proposal,
    f.source.draft.intent.facts
  )
  f.source.receipt.draftDigest = digest(f.source.draft)
  f.source.receipt.proposalDigest = digest(f.source.proposal)
  f.view.draft = structuredClone(f.source.draft)
  f.view.application = structuredClone(f.source.receipt)
  f.view.graph!.draftDigest = f.source.receipt.draftDigest
  f.view.graph!.proposalDigest = f.source.receipt.proposalDigest
  f.view.tasks[0].maxAttempts = 2
}
beforeEach(() => {
  vi.resetAllMocks()
  f = workflowPlanGraphFixture()
  const account = workbenchAccountState('workflow-case-owner')
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveTasks: api,
      hiveAccount: {
        getState: async () => account,
        onStateChanged: (listener: (state: HiveAccountState) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        }
      }
    }
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  api.getWorkflowPlanGraph.mockResolvedValue(available())
  api.startWorkflowPlanGraph.mockImplementation(async (input) => ({
    admission: {
      requestId: input.requestId,
      payloadFingerprint: digest({ operation: 'plans.graph.start', input }),
      replayed: false
    },
    view: { ...f.view, graph: { ...f.view.graph!, requestId: input.requestId } }
  }))
  api.cancelWorkflowPlanGraph.mockImplementation(async (input) => ({
    admission: {
      requestId: input.requestId,
      payloadFingerprint: digest({ operation: 'plans.graph.cancel', input }),
      replayed: false
    },
    view: {
      ...f.view,
      graph: { ...f.view.graph!, revision: 2, status: 'cancel_requested' },
      availability: { available: false, reason: 'graph_cancelled' }
    }
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  listeners.clear()
  vi.useRealTimers()
})
describe('adopted plan execution UI', () => {
  it('reads authentic scope before exposing start and sends explicit duration and digests', async () => {
    await mount()
    expect(api.getWorkflowPlanGraph).toHaveBeenCalledWith({
      projectId: f.view.projectId,
      caseId: f.view.caseId,
      applicationRef: f.view.application.applicationRef
    })
    await click('planGraph.start')
    expect(api.startWorkflowPlanGraph.mock.calls[0][0]).toMatchObject({
      expectedCaseRevision: f.source.caseView.revision,
      expectedProjectRevision: f.view.application.projectBindingRevision,
      requestedDurationMs: f.view.graph!.maxDurationMs,
      draftDigest: f.view.application.draftDigest,
      proposalDigest: f.view.application.proposalDigest
    })
    expect(container.textContent).toContain('planGraph.states.running')
    expect(container.querySelectorAll('[data-plan-graph-task]')).toHaveLength(f.view.tasks.length)
  })
  it('keeps the request across an ambiguous response and prevents double admission', async () => {
    await mount()
    const waiting = deferredWorkbenchValue<unknown>()
    api.startWorkflowPlanGraph.mockReturnValueOnce(waiting.promise)
    await click('planGraph.start')
    expect(button('planGraph.start').disabled).toBe(true)
    await click('planGraph.start')
    expect(api.startWorkflowPlanGraph).toHaveBeenCalledOnce()
    await act(async () => waiting.reject(new Error('SERVICE_UNAVAILABLE')))
    api.startWorkflowPlanGraph.mockRejectedValue(new Error('SERVICE_UNAVAILABLE'))
    await click('planGraph.start')
    expect(api.startWorkflowPlanGraph.mock.calls[1][0]).toEqual(
      api.startWorkflowPlanGraph.mock.calls[0][0]
    )
  })
  it.each([
    'source_busy',
    'resource_loading_unavailable',
    'knowledge_access_unavailable',
    'hard_budget_unavailable',
    'unsupported_graph',
    'independent_review_required'
  ])('shows %s without starting', async (reason) => {
    api.getWorkflowPlanGraph.mockResolvedValue({
      ...available(),
      availability: { available: false, reason }
    })
    await mount()
    expect(container.textContent).toContain(`planGraph.reasons.${reason}`)
    expect(container.textContent).not.toContain('planGraph.start')
    expect(api.startWorkflowPlanGraph).not.toHaveBeenCalled()
  })
  it('rejects a forged original draft without displaying tasks or start', async () => {
    const page = structuredClone(available())
    page.draft.intent.facts.planRevision = 900
    api.getWorkflowPlanGraph.mockResolvedValue(page)
    await mount()
    expect(container.querySelector('[role=alert]')).not.toBeNull()
    expect(container.querySelector('[data-plan-graph-task]')).toBeNull()
  })
  it('shows cancel requested distinctly without treating it as cancelled', async () => {
    api.getWorkflowPlanGraph.mockResolvedValue(f.view)
    await mount()
    await click('planGraph.cancel')
    expect(container.textContent).toContain('planGraph.states.cancel_requested')
    expect(container.textContent).not.toContain('planGraph.states.cancelled')
    expect(container.textContent).not.toContain('planGraph.reasons.graph_cancelled')
    expect(container.textContent).not.toContain('planGraph.cancel')
    expect(api.retryWorkflowPlanTask).not.toHaveBeenCalled()
  })
  it('rejects a graph revision rollback on refresh', async () => {
    api.getWorkflowPlanGraph.mockResolvedValue({
      ...f.view,
      graph: { ...f.view.graph!, revision: 3 }
    })
    await mount()
    api.getWorkflowPlanGraph.mockResolvedValue(f.view)
    await click('planApply.refresh')
    expect(container.querySelector('[role=alert]')?.textContent).toContain('errors.changed')
    expect(container.textContent).toContain('planGraph.states.running')
  })
  it('reads the report only from its authenticated original run and bounds its displayed text', async () => {
    const page = withReport(),
      outcome = page.outcomes[0]
    api.getWorkflowPlanGraph.mockResolvedValue(page)
    api.artifact.mockResolvedValue({ name: 'implementation.md', text: 'x'.repeat(40_000) })
    await mount()
    await click('planGraph.report')
    expect(api.artifact).toHaveBeenCalledWith(
      outcome.producer.task.taskId,
      outcome.producer.task.runId,
      outcome.reportVersion.artifactRef
    )
    expect(container.querySelector('pre')?.textContent).toHaveLength(32_768)
    expect(container.textContent).toContain('planGraph.reportTruncated')
  })
  it('discards a report delivered after sign-out', async () => {
    api.getWorkflowPlanGraph.mockResolvedValue(withReport())
    const waiting = deferredWorkbenchValue<unknown>()
    api.artifact.mockReturnValue(waiting.promise)
    await mount()
    await click('planGraph.report')
    await act(async () => {
      for (const listener of listeners) {
        listener({
          ...workbenchAccountState('workflow-case-owner'),
          status: 'signed-out',
          account: undefined
        })
      }
    })
    await act(async () => waiting.resolve({ name: 'implementation.md', text: 'private report' }))
    expect(container.textContent).not.toContain('private report')
  })
  it('clears an earlier attempt report as soon as retry changes the original run', async () => {
    allowSecondAttempt()
    const page = withReport()
    page.graph!.status = 'paused'
    page.tasks[0].status = 'blocked'
    page.tasks[0].blockedReason = 'failed'
    page.runs[0].status = 'failed'
    page.outcomes[0].status = 'failed'
    api.getWorkflowPlanGraph.mockResolvedValue(page)
    api.artifact.mockResolvedValue({ name: 'requirements.md', text: 'attempt one report' })
    await mount()
    await click('planGraph.report')
    expect(container.textContent).toContain('attempt one report')
    const next = structuredClone(page),
      prior = next.runs[0]
    const task = { ...prior.task, runId: '11111111-2222-4333-8444-555555555555', attempt: 2 }
    next.graph!.status = 'running'
    next.graph!.revision++
    next.tasks[0].latestRun = task
    next.tasks[0].status = 'todo'
    next.tasks[0].blockedReason = null
    next.runs.push({ ...prior, task, status: 'pending', hasResult: false })
    api.retryWorkflowPlanTask.mockImplementation(async (input) => ({
      admission: {
        requestId: input.requestId,
        payloadFingerprint: digest({ operation: 'plans.graph.retry', input }),
        replayed: false
      },
      view: next
    }))
    await click('planGraph.retry')
    expect(container.textContent).not.toContain('attempt one report')
    expect(container.querySelector('pre')).toBeNull()
    next.runs[1].status = 'succeeded'
    next.runs[1].hasResult = true
    next.tasks[0].status = 'done'
    next.outcomes.push({
      ...next.outcomes[0],
      status: 'succeeded',
      outcomeRef: 'graph:outcome:second',
      producer: { ...next.outcomes[0].producer, task },
      summary: 'attempt two summary'
    })
    api.getWorkflowPlanGraph.mockResolvedValue(next)
    await click('planApply.refresh')
    expect(container.textContent).toContain('attempt two summary')
    expect(container.textContent).not.toContain('attempt one report')
  })
  it('resumes only a settled admission pause using the exact graph revision', async () => {
    const page = withReport()
    page.graph!.status = 'paused'
    page.graph!.pauseCause = {
      kind: 'admission_unavailable',
      causeRunId: page.runs[0].task.runId,
      proposalTaskRef: page.tasks[0].proposalTaskRef,
      code: 'REVISION_CONFLICT',
      reason: 'revision_conflict'
    }
    api.getWorkflowPlanGraph.mockResolvedValue(page)
    api.resumeWorkflowPlanGraph.mockImplementation(async (input) => ({
      admission: {
        requestId: input.requestId,
        payloadFingerprint: digest({ operation: 'plans.graph.resume', input }),
        replayed: false
      },
      view: {
        ...page,
        graph: { ...page.graph!, pauseCause: undefined, status: 'running', revision: 2 }
      }
    }))
    await mount()
    await click('planGraph.resume')
    expect(api.resumeWorkflowPlanGraph.mock.calls[0][0]).toMatchObject({
      graphRef: page.graph!.graphRef,
      expectedGraphRevision: page.graph!.revision,
      applicationRef: page.application.applicationRef
    })
    expect(container.textContent).toContain('planGraph.states.running')
  })
  it('does not offer resume when an individually cancelled sibling remains', async () => {
    f.source.proposal.tasks.push({ ...f.source.proposal.tasks[0], taskRef: 'cancelled-sibling' })
    f.source.draft.inspection = inspectWorkflowPlanProposal(
      f.source.proposal,
      f.source.draft.intent.facts
    )
    const mapping = {
      ...f.source.receipt.createdTaskRefs[0],
      proposalTaskRef: 'cancelled-sibling',
      taskId: '11111111-2222-4333-8444-666666666666'
    }
    f.source.receipt.createdTaskRefs.push(mapping)
    f.source.receipt.draftDigest = digest(f.source.draft)
    f.source.receipt.proposalDigest = digest(f.source.proposal)
    f.view.draft = structuredClone(f.source.draft)
    f.view.application = structuredClone(f.source.receipt)
    f.view.graph!.draftDigest = f.source.receipt.draftDigest
    f.view.graph!.proposalDigest = f.source.receipt.proposalDigest
    const page = withReport(),
      task = {
        ...page.runs[0].task,
        taskId: mapping.taskId,
        runId: '11111111-2222-4333-8444-777777777777'
      }
    page.tasks.push({
      ...page.tasks[0],
      proposalTaskRef: mapping.proposalTaskRef,
      taskId: mapping.taskId,
      latestRun: task,
      status: 'cancelled'
    })
    page.runs.push({
      ...page.runs[0],
      proposalTaskRef: mapping.proposalTaskRef,
      task,
      status: 'cancelled'
    })
    page.graph!.status = 'paused'
    page.graph!.pauseCause = {
      kind: 'admission_unavailable',
      causeRunId: page.runs[0].task.runId,
      proposalTaskRef: mapping.proposalTaskRef,
      code: 'REVISION_CONFLICT',
      reason: 'revision_conflict'
    }
    api.getWorkflowPlanGraph.mockResolvedValue(page)
    await mount()
    expect(container.querySelector('[role=alert]')).toBeNull()
    expect(container.textContent).not.toContain('planGraph.resume')
    expect(api.resumeWorkflowPlanGraph).not.toHaveBeenCalled()
  })
  it.each(workbenchAccountBoundaryStates(workbenchAccountState('workflow-case-owner')))(
    'discards a late result across $name',
    async ({ state }) => {
      const waiting = deferredWorkbenchValue<unknown>()
      api.getWorkflowPlanGraph.mockReturnValue(waiting.promise)
      await mount()
      await act(async () => {
        for (const listener of listeners) {
          listener(state)
        }
      })
      await act(async () => waiting.resolve(available()))
      expect(container.querySelector('[data-plan-graph-task]')).toBeNull()
      expect(container.textContent).not.toContain('planGraph.start')
      expect(api.startWorkflowPlanGraph).not.toHaveBeenCalled()
    }
  )
})
