// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskPageData } from '@/store/slices/ui/ui-slice-contract-core'
import { useTaskPageDismissal } from '../use-task-page-dismissal'
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
  ExternalTaskPage: () => {
    useTaskPageDismissal(state.closeTaskPage, state.activeModal === 'none')
    return <div data-testid="external-page">{JSON.stringify(state.taskPageData)}</div>
  }
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  state.taskPageData = {}
  state.activeModal = 'none'
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
  act(() => root.render(<TaskPage />))
}
function pressEscape() {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    })
  )
}

describe('Tasks provider routing', () => {
  it('opens the external provider page directly on an ordinary Tasks visit', () => {
    render()
    expect(container.querySelector('[data-testid="external-page"]')).not.toBeNull()
    expect(container.querySelector('nav')).toBeNull()
    expect(container.querySelector('[data-testid="native-page"]')).toBeNull()
  })
  it.each(['github', 'gitlab', 'linear', 'jira'] as const)(
    'preserves a direct %s request and repository selection',
    (taskSource) => {
      state.taskPageData = { taskSource, preselectedRepoId: 'repo:one' }
      render()
      expect(container.querySelector('[data-testid="external-page"]')?.textContent).toBe(
        JSON.stringify(state.taskPageData)
      )
      expect(container.querySelector('nav')).toBeNull()
    }
  )
  it('keeps the provider page mounted when returning to an ordinary Tasks visit', () => {
    state.taskPageData = { taskSource: 'linear' }
    render()
    state.taskPageData = {}
    render()
    expect(container.querySelector('[data-testid="external-page"]')).not.toBeNull()
  })
  it('delegates Escape dismissal to the provider page exactly once', () => {
    render()
    pressEscape()
    expect(state.closeTaskPage).toHaveBeenCalledOnce()
    state.activeModal = 'settings'
    render()
    pressEscape()
    expect(state.closeTaskPage).toHaveBeenCalledOnce()
  })
})
