// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import {
  HiveWorkflowCaseViewSchema,
  type HiveWorkflowCaseView
} from '../../../../../shared/hive-workflow-cases'
import { structuredAgentSessionDigest } from '../../../../../shared/structured-agent-session-mutation'
import type {
  HiveWorkflowCaseRun,
  HiveWorkflowCaseStart
} from '../../../../../shared/hive-workflow-case-runs'
import { useHiveWorkflowCaseRuns } from './use-hive-workflow-case-runs'
import {
  deferredWorkbenchValue,
  workbenchAccountState,
  workbenchAccountRefreshStates,
  workbenchId
} from './hive-workbench.test-fixtures'
import { executableWorkflowCase, workflowCaseRun } from './hive-workflow-case-run.test-fixtures'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const view = executableWorkflowCase()
const second = executableWorkflowCase(201)
const terminalStatuses: HiveWorkflowCaseRun['status'][] = ['succeeded', 'failed', 'cancelled']
const taskStatuses: HiveWorkflowCaseView['stageTasks'][number]['status'][] = [
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled'
]
const observingStatuses: HiveWorkflowCaseRun['status'][] = ['running', 'unknown', 'cancelRequested']
const api = {
  startWorkflowCase: vi.fn(),
  getWorkflowCaseRuns: vi.fn(),
  cancel: vi.fn(),
  artifact: vi.fn()
}
const reload = vi.fn<() => Promise<boolean>>()
const listeners = new Set<(state: HiveAccountState) => void>()
let root: Root, container: HTMLDivElement, current: ReturnType<typeof useHiveWorkflowCaseRuns>
function Harness({ selected = view }: { selected?: HiveWorkflowCaseView | null }) {
  current = useHiveWorkflowCaseRuns(selected, true, reload)
  return (
    <p>
      {current.runs.map((run) => run.title).join(',')}
      {current.artifact?.text}
    </p>
  )
}
async function mount(selected: HiveWorkflowCaseView | null = view) {
  await act(async () => {
    root.render(<Harness selected={selected} />)
  })
}
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  api.getWorkflowCaseRuns.mockResolvedValue([])
  api.startWorkflowCase.mockImplementation((input: HiveWorkflowCaseStart) =>
    Promise.resolve(workflowCaseRun(view, 'running', undefined, input))
  )
  reload.mockReset().mockResolvedValue(true)
  listeners.clear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveTasks: api,
      hiveAccount: {
        getState: vi.fn().mockResolvedValue(workbenchAccountState()),
        onStateChanged: (listener: (state: HiveAccountState) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        }
      }
    }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('case stage admission, observation and account boundaries', () => {
  it('reloads business progress after a terminal native observation before polling stops', async () => {
    api.getWorkflowCaseRuns.mockResolvedValueOnce([workflowCaseRun(view, 'running')])
    await mount()
    expect(reload).toHaveBeenCalledWith(view.id)
    reload.mockClear()
    const original = current.runs[0]
    api.getWorkflowCaseRuns.mockResolvedValueOnce([{ ...original, status: 'succeeded' }])
    await act(async () => {
      await current.refresh()
    })
    expect(current.runs[0].status).toBe('succeeded')
    expect(reload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith(view.id)
  })
  it('keeps an empty initial run observation from rereading or changing the selected Case', async () => {
    await mount()
    expect(current.runs).toEqual([])
    expect(reload).not.toHaveBeenCalled()
  })
  it('admits one exact assigned stage for simultaneous clicks and reloads real case revisions', async () => {
    await mount()
    const pending = deferredWorkbenchValue<HiveWorkflowCaseRun>()
    api.startWorkflowCase.mockReturnValueOnce(pending.promise)
    let admitted!: Promise<boolean>
    await act(async () => {
      admitted = current.start()
      expect(await current.start()).toBe(false)
    })
    expect(api.startWorkflowCase).toHaveBeenCalledOnce()
    expect(current.busy).toBe(true)
    expect(api.startWorkflowCase.mock.calls[0][0]).toMatchObject({
      projectId: view.binding.scope.projectRef,
      caseId: view.id,
      expectedCaseRevision: view.revision,
      stageRef: view.currentStageRef,
      expectedTaskRevision: view.stageTasks[0].taskRevision
    })
    await act(async () => {
      pending.resolve(
        workflowCaseRun(view, 'running', undefined, api.startWorkflowCase.mock.calls[0][0])
      )
      await admitted
    })
    expect(reload).toHaveBeenCalledWith(view.id)
    expect(current.runs[0].status).toBe('unknown')
    expect(current.canStart).toBe(false)
  })
  it('retains the entire admission payload after lost responses and across case selection', async () => {
    vi.useFakeTimers()
    api.startWorkflowCase.mockRejectedValueOnce(new Error('OUTCOME_UNKNOWN'))
    await mount()
    await act(async () => {
      expect(await current.start()).toBe(false)
    })
    const payload = api.startWorkflowCase.mock.calls[0][0]
    expect(current.uncertain).toBe(true)
    await mount(second)
    api.getWorkflowCaseRuns.mockResolvedValue([
      workflowCaseRun(view, 'succeeded', undefined, payload)
    ])
    await mount({
      ...view,
      revision: 2,
      stageTasks: view.stageTasks.map((task) => ({ ...task, status: 'in_review' }))
    })
    expect(current.canStart).toBe(true)
    await act(async () => {
      expect(await current.start()).toBe(true)
    })
    expect(api.startWorkflowCase.mock.calls[1][0]).toEqual(payload)
    expect(current.uncertain).toBe(false)
  })
  it('keeps an unknown run cancellable and stops observation after terminal evidence', async () => {
    vi.useFakeTimers()
    const unknown = workflowCaseRun(view, 'unknown')
    api.getWorkflowCaseRuns.mockResolvedValue([unknown])
    api.cancel.mockResolvedValue({
      id: unknown.task.taskId,
      runId: unknown.task.runId,
      title: unknown.title,
      status: 'cancelRequested',
      artifactRefs: []
    })
    await mount()
    api.getWorkflowCaseRuns.mockResolvedValue([{ ...unknown, status: 'cancelRequested' }])
    await act(async () => {
      expect(await current.cancel(unknown)).toBe(true)
    })
    expect(api.cancel).toHaveBeenCalledWith(unknown.task.taskId, unknown.task.runId)
    expect(current.runs[0].status).toBe('cancelRequested')
    expect(current.canStart).toBe(false)
    api.getWorkflowCaseRuns.mockResolvedValue([{ ...unknown, status: 'cancelled' }])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(current.canStart).toBe(false)
    const reads = api.getWorkflowCaseRuns.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000)
    })
    expect(api.getWorkflowCaseRuns).toHaveBeenCalledTimes(reads)
    expect(api.startWorkflowCase).not.toHaveBeenCalled()
  })
  it('admits the actual root product stage when the validated DAG array is reordered', async () => {
    const definition = {
      ...view.workflow.definition,
      stages: [...view.workflow.definition.stages.slice(1), view.workflow.definition.stages[0]]
    }
    const definitionDigest = structuredAgentSessionDigest({ name: view.workflow.name, definition })
    const reordered = HiveWorkflowCaseViewSchema.parse({
      ...view,
      definitionDigest,
      workflow: { ...view.workflow, definition, definitionDigest },
      stageTasks: [...view.stageTasks.slice(1), view.stageTasks[0]]
    })
    api.startWorkflowCase.mockImplementation((input: HiveWorkflowCaseStart) =>
      Promise.resolve(workflowCaseRun(reordered, 'running', undefined, input))
    )
    await mount(reordered)
    expect(reordered.workflow.definition.stages[0].role).toBe('developer')
    expect(current.canStart).toBe(true)
    await act(async () => {
      expect(await current.start()).toBe(true)
    })
    expect(api.startWorkflowCase.mock.calls[0][0].stageRef).toBe(reordered.currentStageRef)
  })
  it('recovers a durable pending admission in a new hook instance with the original nonce', async () => {
    await mount()
    api.startWorkflowCase.mockRejectedValueOnce(new Error('OUTCOME_UNKNOWN'))
    await act(async () => {
      expect(await current.start()).toBe(false)
    })
    const original: HiveWorkflowCaseStart = api.startWorkflowCase.mock.calls[0][0]
    const pending = workflowCaseRun(view, 'pending', undefined, original)
    const admittedView = HiveWorkflowCaseViewSchema.parse({
      ...view,
      revision: 2,
      stageTasks: view.stageTasks.map((task) =>
        task.stageRef === view.currentStageRef
          ? { ...task, status: 'in_progress', taskRevision: 1 }
          : task
      )
    })
    act(() => root.render(null))
    api.getWorkflowCaseRuns.mockResolvedValue([pending])
    await mount(admittedView)
    expect(current.uncertain).toBe(false)
    expect(current.resumable).toBe(true)
    expect(current.canStart).toBe(true)
    const running = { ...pending, status: 'running' }
    api.startWorkflowCase.mockResolvedValue(running)
    api.getWorkflowCaseRuns.mockResolvedValue([running])
    await act(async () => {
      expect(await current.start()).toBe(true)
    })
    expect(api.startWorkflowCase.mock.calls[1][0]).toEqual(original)
    expect(current.resumable).toBe(false)
    expect(current.canStart).toBe(false)
  })
  it.each(observingStatuses)(
    'keeps restored %s runs in observation and cancellation without replaying admission',
    async (status) => {
      api.getWorkflowCaseRuns.mockResolvedValue([workflowCaseRun(view, status)])
      await mount()
      expect(current.resumable).toBe(false)
      expect(current.uncertain).toBe(false)
      expect(current.canStart).toBe(false)
      expect(await current.start()).toBe(false)
      expect(api.startWorkflowCase).not.toHaveBeenCalled()
    }
  )
  it('revokes the recovered pending action when the exact run becomes running, including stale callbacks', async () => {
    const pending = workflowCaseRun(view, 'pending')
    api.getWorkflowCaseRuns.mockResolvedValue([pending])
    await mount()
    const stale = current
    api.getWorkflowCaseRuns.mockResolvedValue([{ ...pending, status: 'running' }])
    await act(async () => {
      await current.refresh()
      expect(await stale.start()).toBe(false)
    })
    expect(current.resumable).toBe(false)
    expect(current.canStart).toBe(false)
    expect(api.startWorkflowCase).not.toHaveBeenCalled()
  })
  it('does not offer recovery for a pending run after the case current stage changes', async () => {
    api.getWorkflowCaseRuns.mockResolvedValue([workflowCaseRun(view, 'pending')])
    await mount()
    const stage = view.workflow.definition.stages.find(
      (candidate) => candidate.role === 'developer'
    )
    if (!stage) {
      throw new Error('Test requires a developer stage')
    }
    await mount(HiveWorkflowCaseViewSchema.parse({ ...view, currentStageRef: stage.stageRef }))
    expect(current.resumable).toBe(false)
    expect(current.canStart).toBe(false)
    expect(await current.start()).toBe(false)
    expect(api.startWorkflowCase).not.toHaveBeenCalled()
  })
  it('clears only a recovered request with matching terminal identity and rejects frozen-request replacement', async () => {
    const pending = workflowCaseRun(view, 'pending')
    api.getWorkflowCaseRuns.mockResolvedValue([pending])
    await mount()
    api.getWorkflowCaseRuns.mockResolvedValue([
      {
        ...pending,
        status: 'cancelled',
        startRequest: { ...pending.startRequest, requestId: workbenchId(999) }
      }
    ])
    await act(async () => {
      await current.refresh()
    })
    expect(current.error).toBe('INVALID_RESPONSE')
    expect(current.resumable).toBe(true)
    api.getWorkflowCaseRuns.mockResolvedValue([{ ...pending, status: 'cancelled' }])
    await act(async () => {
      await current.refresh()
    })
    expect(current.uncertain).toBe(false)
    expect(current.resumable).toBe(false)
    expect(current.canStart).toBe(false)
  })
  it('refuses recovery when the frozen business request belongs to another project', async () => {
    const pending = workflowCaseRun(view, 'pending')
    api.getWorkflowCaseRuns.mockResolvedValue([
      { ...pending, startRequest: { ...pending.startRequest, projectId: workbenchId(999) } }
    ])
    await mount()
    expect(current.error).toBe('INVALID_RESPONSE')
    expect(current.resumable).toBe(false)
    expect(current.canStart).toBe(false)
  })
  it.each(terminalStatuses)('never starts another attempt after a %s stage run', async (status) => {
    api.getWorkflowCaseRuns.mockResolvedValueOnce([workflowCaseRun(view, status)])
    await mount()
    expect(current.canStart).toBe(false)
    await act(async () => {
      expect(await current.start()).toBe(false)
      await current.refresh()
    })
    expect(current.runs).toHaveLength(1)
    expect(current.canStart).toBe(false)
    expect(api.startWorkflowCase).not.toHaveBeenCalled()
  })
  it.each(taskStatuses)(
    'refuses fresh admission for an issue in %s even without a run history',
    async (status) => {
      const selected = HiveWorkflowCaseViewSchema.parse({
        ...view,
        stageTasks: view.stageTasks.map((task) => ({ ...task, status }))
      })
      await mount(selected)
      expect(current.canStart).toBe(false)
      expect(await current.start()).toBe(false)
      expect(api.startWorkflowCase).not.toHaveBeenCalled()
    }
  )
  it('preserves missing active executions as unknown, including when returning to the case', async () => {
    vi.useFakeTimers()
    api.getWorkflowCaseRuns.mockResolvedValueOnce([workflowCaseRun(view)])
    await mount()
    await act(async () => {
      await current.refresh()
    })
    expect(current.runs[0].status).toBe('unknown')
    await mount(second)
    await mount(view)
    expect(current.runs[0].status).toBe('unknown')
    expect(current.canStart).toBe(false)
  })
  it('rejects late admission callbacks after account replacement', async () => {
    const pending = deferredWorkbenchValue<HiveWorkflowCaseRun>()
    await mount()
    api.startWorkflowCase.mockReturnValueOnce(pending.promise)
    let admission!: Promise<boolean>
    await act(async () => {
      admission = current.start()
    })
    await act(async () => {
      listeners.forEach((listener) => listener(workbenchAccountState('other-owner')))
      pending.resolve(
        workflowCaseRun(view, 'running', undefined, api.startWorkflowCase.mock.calls[0][0])
      )
      expect(await admission).toBe(false)
    })
    expect(current.runs).toEqual([])
    expect(current.busy).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    expect(await current.start()).toBe(false)
  })
  it('keeps short token and display-name refreshes within the same account', async () => {
    api.getWorkflowCaseRuns.mockResolvedValue([workflowCaseRun(view)])
    await mount()
    await act(async () => {
      workbenchAccountRefreshStates(workbenchAccountState()).forEach((account) => {
        listeners.forEach((listener) => listener(account))
      })
    })
    expect(current.runs).toHaveLength(1)
  })
  it('rejects late reads on case replacement and never dispatches stale selected callbacks', async () => {
    const pending = deferredWorkbenchValue<HiveWorkflowCaseRun[]>()
    api.getWorkflowCaseRuns.mockReturnValueOnce(pending.promise)
    await mount()
    const stale = current
    await mount(second)
    await act(async () => {
      pending.resolve([workflowCaseRun(view)])
    })
    expect(current.runs).toEqual([])
    expect(await stale.start()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
  it('does not expose late artifacts from an earlier case', async () => {
    const run = workflowCaseRun(view, 'succeeded')
    api.getWorkflowCaseRuns.mockResolvedValueOnce([run])
    const pending = deferredWorkbenchValue<{ name: string; text: string }>()
    api.artifact.mockReturnValueOnce(pending.promise)
    await mount()
    let result!: Promise<boolean>
    await act(async () => {
      result = current.readArtifact(run, run.artifactRefs[0])
    })
    await mount(second)
    await act(async () => {
      pending.resolve({ name: 'secret.md', text: 'private first case' })
      expect(await result).toBe(false)
    })
    expect(current.artifact).toBeNull()
    expect(container.textContent).not.toContain('private first case')
  })
  it('validates bounded public schemas, case identity and cancel identity before updates', async () => {
    api.getWorkflowCaseRuns.mockResolvedValue([workflowCaseRun(second)])
    await mount()
    expect(current.error).toBe('INVALID_RESPONSE')
    expect(current.canStart).toBe(false)
    const run = workflowCaseRun(view, 'unknown')
    api.getWorkflowCaseRuns.mockResolvedValue([run])
    await act(async () => {
      await current.refresh()
    })
    api.cancel.mockResolvedValue({
      id: 'other-task',
      runId: run.task.runId,
      title: run.title,
      status: 'cancelled',
      artifactRefs: []
    })
    await act(async () => {
      expect(await current.cancel(run)).toBe(false)
    })
    expect(current.runs[0].status).toBe('unknown')
    api.getWorkflowCaseRuns.mockResolvedValue(Array.from({ length: 97 }, () => run))
    await act(async () => {
      await current.refresh()
    })
    expect(current.error).toBe('INVALID_RESPONSE')
  })
  it('cleans polling and account listeners when unmounted', async () => {
    vi.useFakeTimers()
    api.getWorkflowCaseRuns.mockResolvedValue([workflowCaseRun(view)])
    await mount()
    expect(listeners.size).toBe(1)
    act(() => root.render(null))
    expect(listeners.size).toBe(0)
    await vi.advanceTimersByTimeAsync(9000)
    expect(api.getWorkflowCaseRuns).toHaveBeenCalledOnce()
  })
  it('makes unavailable isolation explicit and blocks stage admission', async () => {
    await mount({
      ...view,
      executionAvailability: { available: false, reason: 'EXECUTION_ISOLATION_UNAVAILABLE' }
    })
    expect(current.canStart).toBe(false)
    expect(await current.start()).toBe(false)
    expect(api.startWorkflowCase).not.toHaveBeenCalled()
  })
})
