// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessageList } from '@/components/native-chat/NativeChatMessageList'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { HiveWorkflowCaseRun } from '../../../../../shared/hive-workflow-case-runs'
import { HiveWorkflowCaseRuns } from './HiveWorkflowCaseRuns'
import type { HiveWorkflowCaseRunsModel } from './use-hive-workflow-case-runs'
import { executableWorkflowCase, workflowCaseRun } from './hive-workflow-case-run.test-fixtures'
import { workflowSessionPage } from './hive-workflow-case-session.test-fixtures'
import { deferredWorkbenchValue, workbenchAccountState } from './hive-workbench.test-fixtures'

const list = vi.hoisted(() =>
  vi.fn<(props: ComponentProps<typeof NativeChatMessageList>) => void>()
)
vi.mock('@/components/native-chat/NativeChatMessageList', () => ({
  NativeChatMessageList: (props: ComponentProps<typeof NativeChatMessageList>) => {
    list(props)
    return <div data-passive-transcript>{props.session.messages.length}</div>
  }
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const api = { getWorkflowCaseSessionPage: vi.fn(), startWorkflowCase: vi.fn(), cancel: vi.fn() }
const listeners = new Set<(account: HiveAccountState) => void>()
let root: Root, container: HTMLDivElement
const view = executableWorkflowCase()
let model: HiveWorkflowCaseRunsModel
function selectedModel(runs: HiveWorkflowCaseRun[]): HiveWorkflowCaseRunsModel {
  return {
    scope: 'original',
    runs,
    pending: null,
    loaded: true,
    error: null,
    artifact: null,
    uncertain: false,
    resumable: false,
    busy: false,
    canStart: false,
    refresh: vi.fn().mockResolvedValue(true),
    start: vi.fn().mockResolvedValue(false),
    cancel: vi.fn().mockResolvedValue(false),
    clearArtifact: vi.fn(),
    readArtifact: vi.fn().mockResolvedValue(false)
  }
}
async function mount(selected: HiveWorkflowCaseView = view) {
  await act(async () => {
    root.render(
      <HiveWorkflowCaseRuns view={selected} model={model} scopeLabel="Original project" />
    )
  })
}
async function openSession() {
  await act(async () => {
    button('hiveWorkflowCases.session.open').click()
  })
  await act(async () => {
    await vi.dynamicImportSettled()
  })
}
function button(key: string) {
  const found = [...container.querySelectorAll('button')].find((node) => node.textContent === key)
  if (!found) {
    throw new Error(`Missing button ${key}`)
  }
  return found
}
beforeEach(() => {
  list.mockReset()
  Object.values(api).forEach((mock) => mock.mockReset())
  api.getWorkflowCaseSessionPage.mockImplementation((query) =>
    Promise.resolve(workflowSessionPage(query))
  )
  model = selectedModel([workflowCaseRun(view, 'succeeded')])
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
})
describe('original stage session entry and passive panel', () => {
  it.each(['succeeded', 'failed', 'cancelled', 'unknown', 'running', 'cancelRequested'] as const)(
    'keeps original session reading available for %s runs without starting execution',
    async (status) => {
      const run = workflowCaseRun(view, status)
      model = selectedModel([run])
      await mount()
      await openSession()
      expect(api.getWorkflowCaseSessionPage).toHaveBeenCalledWith({
        projectId: view.binding.scope.projectRef,
        caseId: view.id,
        taskId: run.task.taskId,
        runId: run.task.runId,
        direction: 'tail',
        limit: 40
      })
      const props = list.mock.calls.at(-1)![0]
      expect(props.session.sessionId).toBe('original-session')
      expect(props.session.agent).toBe('codex')
      expect(props.session.readPhase).toBe('ready')
      expect(props.isWorking).toBe(false)
      expect(props.allowFileUriLinks).toBe(false)
      for (const field of ['runtimeContext', 'onLinkClick', 'deliveryNotices', 'railOutline']) {
        expect(props).not.toHaveProperty(field)
      }
      expect(props.journalItems).toHaveLength(2)
      expect(props.journalSubmissions).toEqual([])
      expect(props.session.messages).toHaveLength(2)
      expect(
        container.querySelectorAll('textarea,input,[contenteditable=true],iframe')
      ).toHaveLength(0)
      expect(api.startWorkflowCase).not.toHaveBeenCalled()
      expect(api.cancel).not.toHaveBeenCalled()
      expect(model.start).not.toHaveBeenCalled()
      expect(model.cancel).not.toHaveBeenCalled()
    }
  )
  it('disables duplicate row selection during reading and closes without changing the selected Case', async () => {
    const pending = deferredWorkbenchValue<unknown>()
    api.getWorkflowCaseSessionPage.mockReturnValue(pending.promise)
    await mount()
    await act(async () => {
      button('hiveWorkflowCases.session.open').click()
      button('hiveWorkflowCases.session.open').click()
    })
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(api.getWorkflowCaseSessionPage).toHaveBeenCalledOnce()
    expect(button('hiveWorkflowCases.session.open').disabled).toBe(true)
    act(() => button('hiveWorkflowCases.session.close').click())
    await act(async () => {
      pending.resolve(workflowSessionPage())
    })
    expect(container.querySelector('[data-case-session-reader]')).toBeNull()
    expect(container.textContent).toContain('Original project')
    expect(container.querySelectorAll('[data-case-stage-run]')).toHaveLength(1)
    expect(model.refresh).not.toHaveBeenCalled()
    expect(model.start).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })
  it('preserves the reader while the same Case revision changes but closes it on Case selection', async () => {
    await mount()
    await openSession()
    await mount({ ...view, revision: view.revision + 1 })
    expect(api.getWorkflowCaseSessionPage).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-case-session-reader]')).not.toBeNull()
    await mount(executableWorkflowCase(201))
    expect(container.querySelector('[data-case-session-reader]')).toBeNull()
    await mount(view)
    expect(container.querySelector('[data-case-session-reader]')).toBeNull()
  })
  it('keeps safe localized error and retry controls without displaying private error text', async () => {
    api.getWorkflowCaseSessionPage.mockRejectedValue(
      new Error('private provider acquisition material')
    )
    await mount()
    await openSession()
    expect(container.querySelector('[role=alert]')?.textContent).toBe(
      'hiveWorkflowCases.session.errors.unavailable'
    )
    expect(container.textContent).not.toContain('private provider acquisition material')
    expect(button('hiveWorkflowCases.session.refresh').disabled).toBe(false)
    expect(list).not.toHaveBeenCalled()
    api.getWorkflowCaseSessionPage.mockImplementation((query) =>
      Promise.resolve(workflowSessionPage(query))
    )
    await act(async () => {
      button('hiveWorkflowCases.session.refresh').click()
    })
    expect(container.querySelector('[role=alert]')).toBeNull()
    expect(list).toHaveBeenCalled()
  })
  it('disables the row while the original Case model is busy', async () => {
    model = { ...model, busy: true }
    await mount()
    expect(button('hiveWorkflowCases.session.open').disabled).toBe(true)
    expect(api.getWorkflowCaseSessionPage).not.toHaveBeenCalled()
  })
})
