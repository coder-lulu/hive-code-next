// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  launch: vi.fn(),
  close: vi.fn(),
  update: vi.fn(),
  open: vi.fn(),
  listener: null as (() => void) | null,
  items: [] as {
    key: string
    worktreeId: string
    executionHostId: string
    agent: string
    tabId: string
  }[],
  detection: vi.fn(),
  workspace: {
    id: 'main',
    identityKey: 'ssh:server|main',
    workspaceKey: 'worktree:main',
    kind: 'worktree',
    executionHostId: 'ssh:server',
    repoName: 'Project',
    name: 'main'
  }
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({}) }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/lib/sidebar-worktree-activation', () => ({
  activateWorktreeFromSidebar: mocks.activate
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: mocks.launch }))
vi.mock('@/lib/agent-catalog', () => ({
  getAgentCatalog: () => [{ id: 'claude', label: 'Claude' }]
}))
vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: (target: unknown) => {
    mocks.detection(target)
    return { detectedIds: ['claude'], isLoading: false, refresh: vi.fn() }
  }
}))
vi.mock('./session-catalog', () => ({
  selectSessionCatalog: () => ({
    entities: {
      workspaces: [mocks.workspace],
      projectsByIdentity: new Map([['project', { workspaces: [mocks.workspace] }]])
    }
  })
}))
vi.mock('./use-session-collection', () => ({
  createSessionCollectionSelector: () => () => ({ items: mocks.items })
}))
vi.mock('@/store', () => {
  const state = {
    settings: { disabledTuiAgents: [] },
    updateSessionsView: mocks.update,
    openSessionsPage: mocks.open
  }
  return {
    useAppStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
      getState: () => state,
      subscribe: (fn: () => void) => {
        mocks.listener = fn
        return () => {
          mocks.listener = null
        }
      }
    })
  }
})
import SessionCreateDialog from './SessionCreateDialog'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.items = []
  mocks.listener = null
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
function show() {
  render(
    <SessionCreateDialog scope={{ kind: 'project', projectKey: 'project' }} onClose={mocks.close} />
  )
}
it('only detects agents on mount; launching explicitly carries the workspace owner', () => {
  show()
  expect(mocks.detection).toHaveBeenCalledWith({ kind: 'ssh', connectionId: 'server' })
  expect(mocks.launch).not.toHaveBeenCalled()
  mocks.launch.mockImplementation(() => {
    mocks.items = [
      {
        key: 'created',
        worktreeId: 'main',
        executionHostId: 'ssh:server',
        agent: 'claude',
        tabId: 'tab'
      }
    ]
    return { tabId: 'tab' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  expect(mocks.launch).toHaveBeenCalledWith({
    agent: 'claude',
    worktreeId: 'main',
    executionHostId: 'ssh:server',
    prompt: undefined
  })
  expect(mocks.update).toHaveBeenCalledWith({ selectedSessionKey: 'created' })
  expect(mocks.close).toHaveBeenCalledOnce()
})
it('waits for async publication and ignores sessions from another host or agent', () => {
  mocks.launch.mockReturnValue({ tabId: null, focusAfterMenuClose: 'structured-session' })
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  act(() => {
    mocks.items = [
      { key: 'wrong', worktreeId: 'main', executionHostId: 'local', agent: 'claude', tabId: '1' }
    ]
    mocks.listener?.()
  })
  expect(mocks.close).not.toHaveBeenCalled()
  act(() => {
    mocks.items.push({
      key: 'right',
      worktreeId: 'main',
      executionHostId: 'ssh:server',
      agent: 'claude',
      tabId: '2'
    })
    mocks.listener?.()
  })
  expect(mocks.update).toHaveBeenCalledWith({ selectedSessionKey: 'right' })
})
it('does not relaunch after an uncertain async timeout', () => {
  vi.useFakeTimers()
  mocks.launch.mockReturnValue({ tabId: null })
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  act(() => vi.advanceTimersByTime(30000))
  expect(screen.getByRole('alert').textContent).toContain('has not appeared')
  expect(
    (screen.getByRole('button', { name: 'Start session' }) as HTMLButtonElement).disabled
  ).toBe(true)
  expect(mocks.launch).toHaveBeenCalledOnce()
})

it('keeps a project-created session in the original workbench', () => {
  render(
    <SessionCreateDialog
      scope={{ kind: 'project', projectKey: 'project' }}
      onClose={mocks.close}
      returnToSessions={false}
    />
  )
  mocks.launch.mockImplementation(() => {
    mocks.items = [
      {
        key: 'new',
        worktreeId: 'main',
        executionHostId: 'ssh:server',
        agent: 'claude',
        tabId: 'new-tab'
      }
    ]
    return { tabId: 'new-tab' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  expect(mocks.close).toHaveBeenCalledOnce()
  expect(mocks.activate).toHaveBeenCalledWith('main', 'ssh:server')
  expect(mocks.open).not.toHaveBeenCalled()
  expect(mocks.update).not.toHaveBeenCalled()
})
