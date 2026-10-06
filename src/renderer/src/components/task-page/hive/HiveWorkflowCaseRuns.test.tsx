// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { HiveWorkflowCaseRun } from '../../../../../shared/hive-workflow-case-runs'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import { HiveWorkflowCaseDetail } from './HiveWorkflowCaseDetail'
import { useHiveWorkflowCaseRuns } from './use-hive-workflow-case-runs'
import { deferredWorkbenchValue, workbenchAccountState } from './hive-workbench.test-fixtures'
import { executableWorkflowCase, workflowCaseRun } from './hive-workflow-case-run.test-fixtures'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
  })
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const view = executableWorkflowCase()
const api = {
  getWorkflowCaseRuns: vi.fn(),
  startWorkflowCase: vi.fn(),
  cancel: vi.fn(),
  artifact: vi.fn()
}
const reload = vi.fn<() => Promise<boolean>>()
const listeners = new Set<(account: HiveAccountState) => void>()
let root: Root, container: HTMLDivElement
function Harness({ selected = view }: { selected?: HiveWorkflowCaseView }) {
  const runs = useHiveWorkflowCaseRuns(selected, true, reload)
  return (
    <HiveWorkflowCaseDetail
      view={selected}
      runs={runs}
      scopeLabel="Example team / Desktop project"
    />
  )
}
async function mount(selected = view) {
  await act(async () => {
    root.render(<Harness selected={selected} />)
  })
}
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
  if (!found) {
    throw new Error(`Missing button ${label}`)
  }
  return found
}
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  api.getWorkflowCaseRuns.mockResolvedValue([])
  reload.mockReset().mockResolvedValue(true)
  listeners.clear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveTasks: api,
      hiveAccount: {
        getState: vi.fn().mockResolvedValue(workbenchAccountState()),
        onStateChanged: (listener: (account: HiveAccountState) => void) => {
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
describe('execution within the actual requirement detail', () => {
  it('exposes assigned role, readable project scope and a single current-stage admission', async () => {
    const pending = deferredWorkbenchValue<HiveWorkflowCaseRun>()
    api.startWorkflowCase.mockReturnValue(pending.promise)
    await mount()
    expect(container.textContent).toContain('Example team / Desktop project')
    expect(container.textContent).toContain('执行当前需求的第一阶段')
    expect(container.querySelectorAll('[data-workflow-stage-task]')).toHaveLength(4)
    expect(button('启动当前阶段').disabled).toBe(false)
    await act(async () => {
      button('启动当前阶段').click()
      button('启动当前阶段').click()
    })
    expect(button('启动当前阶段').disabled).toBe(true)
    expect(api.startWorkflowCase).toHaveBeenCalledOnce()
    const run = workflowCaseRun(view, 'unknown', undefined, api.startWorkflowCase.mock.calls[0][0])
    api.getWorkflowCaseRuns.mockResolvedValue([run])
    await act(async () => {
      pending.resolve(run)
    })
    expect(container.querySelector('[data-case-stage-run]')?.textContent).toContain(
      `hiveWorkflow.roles.${run.role}`
    )
    expect(container.textContent).toContain('hiveTasks.status.unknown')
    expect(button('hiveTasks.cancel').disabled).toBe(false)
    expect(button('启动当前阶段').disabled).toBe(true)
  })
  it('renders bounded artifacts using the existing escaped code primitive and closes them', async () => {
    const run = workflowCaseRun(view, 'succeeded')
    api.getWorkflowCaseRuns.mockResolvedValue([run])
    const text = '<script>window.secret = true</script><iframe src="https://example.test" />'
    api.artifact.mockResolvedValue({ name: 'report.html', text })
    await mount()
    await act(async () => {
      button('hiveTasks.artifact').click()
    })
    expect(api.artifact).toHaveBeenCalledWith(run.task.taskId, run.task.runId, run.artifactRefs[0])
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="report.html"]')?.value
    ).toBe(text)
    expect(container.querySelectorAll('script,iframe')).toHaveLength(0)
    act(() => button('hiveTasks.closeArtifact').click())
    expect(container.querySelector('textarea')).toBeNull()
    api.artifact.mockResolvedValue({ name: 'large.txt', text: 'x'.repeat(262_145) })
    await act(async () => {
      button('hiveTasks.artifact').click()
    })
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toHaveLength(262_144)
    expect(container.textContent).toContain('预览仅显示前 262,144 个字符。')
  })
  it('offers recovery for an observed pending stage using its frozen admission request', async () => {
    const pending = workflowCaseRun(view, 'pending')
    api.getWorkflowCaseRuns.mockResolvedValue([pending])
    await mount()
    expect(button('恢复当前阶段').disabled).toBe(false)
    expect(container.textContent).not.toContain('启动当前阶段')
    const running = { ...pending, status: 'running' }
    api.startWorkflowCase.mockResolvedValue(running)
    api.getWorkflowCaseRuns.mockResolvedValue([running])
    await act(async () => {
      button('恢复当前阶段').click()
    })
    expect(api.startWorkflowCase).toHaveBeenCalledWith(pending.startRequest)
    expect(button('启动当前阶段').disabled).toBe(true)
  })
  it('keeps isolation failures visible and the primary action disabled', async () => {
    await mount({
      ...view,
      executionAvailability: { available: false, reason: 'EXECUTION_ISOLATION_UNAVAILABLE' }
    })
    expect(container.textContent).toContain('hiveWorkflowCases.executionUnavailable')
    expect(button('启动当前阶段').disabled).toBe(true)
    expect(api.startWorkflowCase).not.toHaveBeenCalled()
  })
  it('clears artifact data and rejects a late private response on account replacement', async () => {
    const run = workflowCaseRun(view, 'succeeded')
    api.getWorkflowCaseRuns.mockResolvedValue([run])
    const pending = deferredWorkbenchValue<{ name: string; text: string }>()
    api.artifact.mockReturnValue(pending.promise)
    await mount()
    await act(async () => {
      button('hiveTasks.artifact').click()
    })
    await act(async () => {
      listeners.forEach((listener) => listener(workbenchAccountState('replacement-owner')))
      pending.resolve({ name: 'secret.txt', text: 'private account report' })
    })
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).not.toContain('private account report')
    expect(button('启动当前阶段').disabled).toBe(true)
  })
})
