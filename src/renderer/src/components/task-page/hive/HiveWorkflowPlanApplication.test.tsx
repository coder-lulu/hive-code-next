// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import { workflowPlanApplicationFixture } from '../../../../../shared/hive-workflow-plan-application.test-fixture'
import { structuredAgentSessionDigest as digest } from '../../../../../shared/structured-agent-session-mutation'
import { HiveWorkflowPlanApplications } from './HiveWorkflowPlanApplication'
import {
  workbenchAccountState,
  workbenchAccountBoundaryStates,
  deferredWorkbenchValue
} from './hive-workbench.test-fixtures'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values ? JSON.stringify(values) : ''}`
  })
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const api = {
  getWorkflowPlanApplication: vi.fn(),
  applyWorkflowPlan: vi.fn(),
  getWorkflowPlanGraph: vi.fn()
}
const listeners = new Set<(state: HiveAccountState) => void>()
let root: Root, container: HTMLDivElement
let f: ReturnType<typeof workflowPlanApplicationFixture>
function available() {
  return { ...f.view, application: null, taskStates: [], eligibility: { available: true } }
}
function button(label: string) {
  const target = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === `hiveWorkflowCases.planApply.${label}`
  )
  if (!target) {
    throw new Error(`Missing button ${label}`)
  }
  return target
}
async function click(label: string) {
  await act(async () => button(label).click())
}
async function mount(view = f.caseView) {
  await act(async () => root.render(<HiveWorkflowPlanApplications view={view} />))
}
beforeEach(() => {
  vi.resetAllMocks()
  f = workflowPlanApplicationFixture()
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
  api.getWorkflowPlanApplication.mockResolvedValue(available())
  api.getWorkflowPlanGraph.mockImplementation(async () => ({
    caseId: f.caseView.id,
    projectId: f.input.projectId,
    application: f.receipt,
    draft: f.draft,
    graph: null,
    tasks: f.receipt.createdTaskRefs.map((mapping, index) => ({
      proposalTaskRef: mapping.proposalTaskRef,
      taskId: mapping.taskId,
      employeeRef: mapping.employeeRef,
      role: f.proposal.tasks[index].requestedRole,
      taskRevision: 0,
      status: 'blocked',
      maxAttempts: f.proposal.tasks[index].maxAttempts,
      latestRun: null,
      blockedReason: null
    })),
    runs: [],
    outcomes: [],
    availability: { available: true }
  }))
  api.applyWorkflowPlan.mockImplementation(async (input) => ({
    admission: {
      requestId: input.requestId,
      payloadFingerprint: digest({ operation: 'plans.apply', input }),
      replayed: true
    },
    view: f.view
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  listeners.clear()
  vi.useRealTimers()
})
describe('native plan comparison and adoption', () => {
  it('requires a verified read before exposing adoption and displays only real blocked task refs', async () => {
    await mount()
    expect(api.getWorkflowPlanApplication).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('planApply.apply')
    await click('inspect')
    expect(container.textContent).toContain('planApply.firstPlan')
    await click('apply')
    expect(container.querySelectorAll('[data-plan-created-task]')).toHaveLength(
      f.receipt.createdTaskRefs.length
    )
    expect(container.textContent).toContain('planGraph.title')
    expect(container.textContent).toContain('statuses.blocked')
    for (const task of f.receipt.createdTaskRefs) {
      expect(container.textContent).toContain(task.taskId)
    }
    expect(container.textContent).not.toContain('planApply.apply')
  })
  it('disables submission immediately and prevents concurrent mutations', async () => {
    await mount()
    await click('inspect')
    const waiting = deferredWorkbenchValue<unknown>()
    api.applyWorkflowPlan.mockReturnValue(waiting.promise)
    await click('apply')
    expect(button('apply').disabled).toBe(true)
    expect(button('refresh').disabled).toBe(true)
    await click('apply')
    expect(api.applyWorkflowPlan).toHaveBeenCalledOnce()
    await act(async () =>
      waiting.resolve({
        admission: {
          requestId: api.applyWorkflowPlan.mock.calls[0][0].requestId,
          payloadFingerprint: digest({
            operation: 'plans.apply',
            input: api.applyWorkflowPlan.mock.calls[0][0]
          }),
          replayed: true
        },
        view: f.view
      })
    )
  })
  it('keeps the exact request ID across an ambiguous failure and reports refresh as recovery', async () => {
    await mount()
    await click('inspect')
    api.applyWorkflowPlan.mockRejectedValue(new Error('SERVICE_UNAVAILABLE'))
    await click('apply')
    await click('apply')
    expect(api.applyWorkflowPlan.mock.calls[0][0]).toEqual(api.applyWorkflowPlan.mock.calls[1][0])
    expect(container.querySelector('[role=alert]')?.textContent).toContain(
      'planApply.errors.unavailable'
    )
    api.getWorkflowPlanApplication.mockResolvedValue(f.view)
    await click('refresh')
    expect(container.querySelector('[data-plan-application-receipt]')).not.toBeNull()
    expect(container.querySelector('[role=alert]')).toBeNull()
  })
  it('rotates a request ID only when the authenticated target revision changes', async () => {
    await mount()
    await click('inspect')
    api.applyWorkflowPlan.mockRejectedValue(new Error('REVISION_CONFLICT'))
    await click('apply')
    api.getWorkflowPlanApplication.mockResolvedValue({
      ...available(),
      caseRevision: f.caseView.revision + 1
    })
    await click('refresh')
    await click('apply')
    expect(api.applyWorkflowPlan.mock.calls[0][0].requestId).not.toBe(
      api.applyWorkflowPlan.mock.calls[1][0].requestId
    )
  })
  it.each([
    'case_busy',
    'case_cancelled',
    'plan_not_current',
    'project_binding_changed',
    'role_unavailable',
    'plan_replacement_unavailable'
  ])('shows %s and never submits an unavailable plan', async (reason) => {
    api.getWorkflowPlanApplication.mockResolvedValue({
      ...available(),
      eligibility: { available: false, reason }
    })
    await mount()
    await click('inspect')
    expect(container.textContent).toContain(`planApply.reasons.${reason}`)
    expect(api.applyWorkflowPlan).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('planApply.apply')
  })
  it('refuses forged plan differences without exposing adoption', async () => {
    const page = available()
    page.diff!.addedTaskRefs = []
    api.getWorkflowPlanApplication.mockResolvedValue(page)
    await mount()
    await click('inspect')
    expect(container.querySelector('[role=alert]')).not.toBeNull()
    expect(container.textContent).not.toContain('planApply.apply')
  })
  it.each(workbenchAccountBoundaryStates(workbenchAccountState('workflow-case-owner')))(
    'clears data and ignores a late read at the $name boundary',
    async ({ state }) => {
      await mount()
      const waiting = deferredWorkbenchValue<unknown>()
      api.getWorkflowPlanApplication.mockReturnValue(waiting.promise)
      await click('inspect')
      await act(async () => {
        listeners.forEach((listener) => listener(state))
        waiting.resolve(available())
      })
      expect(button('inspect').disabled).toBe(true)
      expect(container.textContent).not.toContain('planApply.apply')
    }
  )
  it('does not inject an old receipt into a different Case after an in-flight mutation', async () => {
    await mount()
    await click('inspect')
    const waiting = deferredWorkbenchValue<unknown>()
    api.applyWorkflowPlan.mockReturnValue(waiting.promise)
    await click('apply')
    const next = workflowPlanApplicationFixture()
    await mount(next.caseView)
    await act(async () =>
      waiting.resolve({
        admission: {
          requestId: api.applyWorkflowPlan.mock.calls[0][0].requestId,
          payloadFingerprint: digest({
            operation: 'plans.apply',
            input: api.applyWorkflowPlan.mock.calls[0][0]
          }),
          replayed: true
        },
        view: f.view
      })
    )
    expect(container.querySelector('[data-plan-application-receipt]')).toBeNull()
  })
})
