// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SessionListItem } from './session-list-types'

const mocks = vi.hoisted(() => ({
  error: null as string | null,
  connection: 'connected',
  publish: vi.fn(),
  mount: vi.fn()
}))
vi.mock('@/store', () => ({ useAppStore: (selector: (state: object) => unknown) => selector({}) }))
vi.mock('@/lib/session-navigation', () => ({
  resolveCurrentSession: (_state: object, item: SessionListItem) =>
    mocks.error
      ? { error: mocks.error }
      : {
          bucketKey: item.ownerBucketKey,
          executionHostId: item.executionHostId,
          terminal: { id: item.terminalTabId },
          tab: { id: item.unifiedTabId }
        },
  resolveSessionConnectionState: () => mocks.connection
}))
vi.mock('../activity/activity-terminal-portal', () => ({
  setSessionPanelPortal: mocks.publish
}))
vi.mock('../terminal/background-terminal-worktree-mount', () => ({
  requestBackgroundTerminalWorktreeMount: mocks.mount
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
import SessionContent from './SessionContent'

const item: SessionListItem = {
  key: 'workspace|tab',
  id: 'session',
  title: 'First',
  kind: 'terminal',
  ownerBucketKey: 'workspace',
  worktreeId: 'workspace',
  unifiedTabId: 'tab',
  terminalTabId: 'terminal',
  tabId: 'tab',
  paneKey: null,
  executionHostId: 'local',
  providerSessionId: null,
  agent: null,
  groupId: 'group',
  projectKey: null,
  projectLabel: null,
  workspaceLabel: 'Workspace',
  workspacePath: '/workspace',
  hostLabel: 'Local',
  lastActivityAt: 0,
  status: {
    activity: 'unknown',
    reason: null,
    lastActivityAt: null,
    connection: 'connected',
    execution: 'unverifiable',
    executionReason: null
  }
}
beforeEach(() => {
  mocks.error = null
  mocks.connection = 'connected'
  vi.clearAllMocks()
})
afterEach(cleanup)

it('publishes the exact terminal owner and keeps the content target stable when switching', () => {
  const view = render(<SessionContent item={item} />)
  const target = screen.getByRole('tabpanel')
  expect(mocks.publish).toHaveBeenLastCalledWith(
    'session-detail',
    expect.objectContaining({ target, worktreeId: 'workspace', tabId: 'terminal' })
  )
  view.rerender(
    <SessionContent
      item={{ ...item, key: 'other|second', ownerBucketKey: 'other', terminalTabId: 'second' }}
    />
  )
  expect(screen.getByRole('tabpanel')).toBe(target)
  expect(mocks.publish).toHaveBeenLastCalledWith(
    'session-detail',
    expect.objectContaining({ target, worktreeId: 'other', tabId: 'second' })
  )
  expect(mocks.mount).toHaveBeenLastCalledWith({ worktreeId: 'other', tabIds: ['second'] })
  view.unmount()
  expect(mocks.publish).toHaveBeenLastCalledWith('session-detail', null)
})

it('clears the previous content and does not mount a disconnected terminal', () => {
  const view = render(<SessionContent item={item} />)
  mocks.connection = 'disconnected'
  mocks.mount.mockClear()
  view.rerender(<SessionContent item={{ ...item }} />)
  expect(mocks.publish).toHaveBeenLastCalledWith('session-detail', null)
  expect(mocks.mount).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toContain('Reconnect')
})

it('rejects an ambiguous owner in place without mounting another workspace', () => {
  mocks.error = 'ambiguous'
  render(<SessionContent item={item} />)
  expect(mocks.mount).not.toHaveBeenCalled()
  expect(mocks.publish).toHaveBeenLastCalledWith('session-detail', null)
  expect(screen.getByRole('status').textContent).toContain('no longer available')
})

it('publishes structured content through its exact existing owner', () => {
  render(<SessionContent item={{ ...item, kind: 'structured', terminalTabId: null }} />)
  expect(mocks.mount).toHaveBeenLastCalledWith({ worktreeId: 'workspace', tabIds: ['tab'] })
  expect(mocks.publish).toHaveBeenLastCalledWith(
    'session-detail',
    expect.objectContaining({ worktreeId: 'workspace', tabId: 'tab' })
  )
})
