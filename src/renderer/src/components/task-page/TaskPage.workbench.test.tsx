// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskPageData } from '@/store/slices/ui/ui-slice-contract-core'
import TaskPage from './TaskPage'

const state = vi.hoisted(() => {
  const taskPageData: TaskPageData = {}
  return { taskPageData, activeModal: 'none', closeTaskPage: vi.fn() }
})
vi.mock('@/store', () => ({
  useAppStore: (select: (value: typeof state) => unknown) => select(state)
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./ExternalTaskPage', () => ({
  ExternalTaskPage: () => <div data-testid="external-page" />
}))
vi.mock('./hive/HiveTeamWorkbench', () => ({
  HiveTeamWorkbench: () => <div data-testid="native-page" />
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  state.taskPageData = {}
  state.closeTaskPage.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
function render() {
  act(() => {
    root.render(<TaskPage />)
  })
}
function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label
  )
  if (!button) {
    throw new Error(`Button not found: ${label}`)
  }
  act(() => button.click())
}

describe('native task-page entry and external routing', () => {
  it('opens the visible native workbench on a normal Tasks visit without mounting external provider hooks', () => {
    render()
    expect(container.querySelector('[data-testid="native-page"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="external-page"]')).toBeNull()
    const team = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'hiveWorkbench.open'
    )
    expect(team?.getAttribute('aria-pressed')).toBe('true')
    click('hiveWorkbench.close')
    expect(state.closeTaskPage).toHaveBeenCalledOnce()
  })
  it('lets users switch to external sources and return directly to team tasks', () => {
    render()
    click('hiveWorkbench.externalSources')
    expect(container.querySelector('[data-testid="external-page"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="native-page"]')).toBeNull()
    click('hiveWorkbench.open')
    expect(container.querySelector('[data-testid="native-page"]')).not.toBeNull()
  })
  it('preserves direct external-provider and repo-scoped navigation', () => {
    state.taskPageData = { taskSource: 'github', preselectedRepoId: 'repo:one' }
    render()
    expect(container.querySelector('[data-testid="external-page"]')).not.toBeNull()
    click('hiveWorkbench.open')
    expect(container.querySelector('[data-testid="native-page"]')).not.toBeNull()
  })
  it('re-evaluates a new navigation request while the task page remains mounted', () => {
    render()
    state.taskPageData = { taskSource: 'linear' }
    render()
    expect(container.querySelector('[data-testid="external-page"]')).not.toBeNull()
    state.taskPageData = {}
    render()
    expect(container.querySelector('[data-testid="native-page"]')).not.toBeNull()
  })
  it('owns Escape only while the native page is selected', () => {
    render()
    const pressEscape = () =>
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true
        })
      )
    pressEscape()
    expect(state.closeTaskPage).toHaveBeenCalledOnce()
    click('hiveWorkbench.externalSources')
    state.closeTaskPage.mockClear()
    pressEscape()
    expect(state.closeTaskPage).not.toHaveBeenCalled()
  })
})
