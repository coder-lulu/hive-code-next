// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { SidebarSessionItem } from './sidebar-session-model'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  activateTemporarySessionInMain: vi.fn(() => false),
  consumeAgentCompletionUnread: vi.fn(),
  consumeFirstAgentCompletionUnreadForTab: vi.fn(),
  deleteTemporarySession: vi.fn(async () => true),
  openActivityPage: vi.fn(),
  state: {} as Record<string, unknown>,
  toastInfo: vi.fn()
}))

vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
  return { useAppStore }
})

vi.mock('@/lib/temporary-session-navigation', () => ({
  activateTemporarySessionInMain: mocks.activateTemporarySessionInMain
}))

vi.mock('@/lib/temporary-session-actions', () => ({
  deleteTemporarySession: mocks.deleteTemporarySession
}))

vi.mock('sonner', () => ({ toast: { info: mocks.toastInfo, error: vi.fn() } }))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import {
  activateSidebarSession,
  confirmSidebarSessionDeletion,
  getSidebarActiveSessionTarget,
  isSidebarSessionActive,
  SessionRow,
  sidebarSessionIdentityKey,
  default as SidebarSessionSection
} from './SidebarSessionSection'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'

const item: SidebarSessionItem = {
  id: 'provider-session',
  title: 'Temporary investigation',
  worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
  ownerBucketKey: FLOATING_TERMINAL_WORKTREE_ID,
  unifiedTabId: 'unified-tab',
  terminalTabId: 'terminal-tab',
  tabId: 'unified-tab',
  paneKey: null,
  executionHostId: 'local',
  status: 'completed',
  lastActivityAt: 100
}

let container: HTMLDivElement
let root: Root
const confirmDeletion = async (): Promise<boolean> => true

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state = {
    consumeAgentCompletionUnread: mocks.consumeAgentCompletionUnread,
    consumeFirstAgentCompletionUnreadForTab: mocks.consumeFirstAgentCompletionUnreadForTab,
    unifiedTabsByWorktree: {},
    tabsByWorktree: {},
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    agentStatusEpoch: 0,
    openActivityPage: mocks.openActivityPage,
    openNewTaskHome: vi.fn(),
    activeView: 'home',
    activeWorktreeId: null,
    activeTabType: null,
    activeTabId: null,
    activeGroupIdByWorktree: {},
    groupsByWorktree: {}
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SidebarSessionSection', () => {
  it('opens a restorable temporary session and consumes its completion badge', () => {
    mocks.activateTemporarySessionInMain.mockReturnValueOnce(true)

    activateSidebarSession(item)

    expect(mocks.activateTemporarySessionInMain).toHaveBeenCalledWith({
      ownerBucketKey: FLOATING_TERMINAL_WORKTREE_ID,
      sessionId: 'provider-session',
      unifiedTabId: 'unified-tab',
      terminalTabId: 'terminal-tab',
      tabId: 'unified-tab',
      executionHostId: 'local'
    })
    expect(mocks.consumeFirstAgentCompletionUnreadForTab).toHaveBeenCalledWith('unified-tab')
  })

  it('keeps a failed temporary restore on the current page', () => {
    activateSidebarSession(item)

    expect(mocks.activateTemporarySessionInMain).toHaveBeenCalledOnce()
    expect(mocks.toastInfo).toHaveBeenCalledOnce()
  })

  it('uses a dedicated drag handle so a normal row click remains reliable', () => {
    const onOpen = vi.fn()
    act(() => {
      root.render(
        <SessionRow
          item={item}
          timeLabels={{
            unused: 'Unused',
            justNow: 'Just now',
            minutesAgo: (value) => `${value}m`,
            hoursAgo: (value) => `${value}h`,
            daysAgo: (value) => `${value}d`
          }}
          onOpen={onOpen}
          onRequestDelete={vi.fn()}
          deleting={false}
          now={Date.now()}
        />
      )
    })

    const row = container.querySelector<HTMLButtonElement>('.sidebar-session-row')
    const dragHandle = container.querySelector<HTMLElement>('.sidebar-session-row-drag-handle')
    expect(row?.hasAttribute('draggable')).toBe(false)
    expect(dragHandle?.getAttribute('draggable')).toBe('true')

    act(() => row?.click())
    expect(onOpen).toHaveBeenCalledOnce()
    expect(container.querySelector('[aria-label="Save task to a project"]')).toBeNull()
  })

  it('marks the active session row as the current page', () => {
    act(() => {
      root.render(
        <SessionRow
          item={item}
          timeLabels={{
            unused: 'Unused',
            justNow: 'Just now',
            minutesAgo: (value) => `${value}m`,
            hoursAgo: (value) => `${value}h`,
            daysAgo: (value) => `${value}d`
          }}
          onOpen={vi.fn()}
          onRequestDelete={vi.fn()}
          deleting={false}
          active
          now={Date.now()}
        />
      )
    })

    const row = container.querySelector<HTMLButtonElement>('.sidebar-session-row')
    expect(row?.classList.contains('is-active')).toBe(true)
    expect(row?.getAttribute('aria-current')).toBe('page')
    expect(row?.dataset.active).toBe('true')
  })

  it('matches the current session by owner bucket and focused unified tab', () => {
    const activeTarget = getSidebarActiveSessionTarget({
      activeView: 'terminal',
      activeWorktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      activeTabType: 'agent-session',
      activeTabId: null,
      activeGroupIdByWorktree: { [FLOATING_TERMINAL_WORKTREE_ID]: 'group-1' },
      groupsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          {
            id: 'group-1',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            activeTabId: 'unified-tab',
            tabOrder: ['unified-tab']
          }
        ]
      }
    })

    expect(isSidebarSessionActive(item, activeTarget)).toBe(true)
    expect(
      isSidebarSessionActive(
        { ...item, ownerBucketKey: `runtime:remote-a|${FLOATING_TERMINAL_WORKTREE_ID}` },
        activeTarget
      )
    ).toBe(false)
  })

  it('does not keep a session selected after leaving the workspace surface', () => {
    const activeTarget = getSidebarActiveSessionTarget({
      activeView: 'activity',
      activeWorktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      activeTabType: 'terminal',
      activeTabId: 'terminal-tab',
      activeGroupIdByWorktree: {},
      groupsByWorktree: {}
    })

    expect(activeTarget).toBeNull()
    expect(isSidebarSessionActive(item, activeTarget)).toBe(false)
  })

  it('deletes only after the destructive confirmation is accepted', async () => {
    const confirm = vi.fn(async () => false)
    const onConfirmed = vi.fn()

    await expect(confirmSidebarSessionDeletion(item, confirm, onConfirmed)).resolves.toBe(false)
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete temporary session?',
        confirmLabel: 'Delete',
        confirmVariant: 'destructive'
      })
    )

    confirm.mockResolvedValueOnce(true)
    await expect(confirmSidebarSessionDeletion(item, confirm, onConfirmed)).resolves.toBe(true)
    expect(onConfirmed).toHaveBeenCalledOnce()
    expect(onConfirmed).toHaveBeenCalledWith(item)
  })

  it('keeps identical provider session ids distinct across host buckets', () => {
    const remoteItem = {
      ...item,
      ownerBucketKey: `runtime:remote-a|${FLOATING_TERMINAL_WORKTREE_ID}`
    }
    const otherRemoteItem = {
      ...item,
      ownerBucketKey: `runtime:remote-b|${FLOATING_TERMINAL_WORKTREE_ID}`
    }

    expect(sidebarSessionIdentityKey(remoteItem)).not.toBe(
      sidebarSessionIdentityKey(otherRemoteItem)
    )
  })

  it('renders four rows, shows the real total, and opens the temporary scope', () => {
    mocks.state.unifiedTabsByWorktree = {
      [FLOATING_TERMINAL_WORKTREE_ID]: Array.from({ length: 6 }, (_, index) => ({
        id: `tab-${index + 1}`,
        entityId: `session-${index + 1}`,
        groupId: 'group-1',
        worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        contentType: 'agent-session',
        label: `Temporary ${index + 1}`,
        customLabel: null,
        color: null,
        sortOrder: index,
        createdAt: index + 1
      }))
    }

    act(() => {
      root.render(
        <ConfirmationDialogContext.Provider value={confirmDeletion}>
          <SidebarSessionSection />
        </ConfirmationDialogContext.Provider>
      )
    })

    expect(container.querySelector('.sidebar-hierarchy-count')?.textContent).toBe('6')
    expect(container.querySelectorAll('.sidebar-session-row')).toHaveLength(4)

    const viewAll = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'View all'
    )
    act(() => viewAll?.click())
    expect(mocks.openActivityPage).toHaveBeenCalledWith({ scope: 'temporary-sessions' })
  })

  it('deletes the exact temporary-session owner after confirmation', async () => {
    mocks.state.unifiedTabsByWorktree = {
      [FLOATING_TERMINAL_WORKTREE_ID]: [
        {
          id: 'delete-tab',
          entityId: 'delete-session',
          structuredSessionId: 'delete-session',
          groupId: 'group-1',
          worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
          contentType: 'agent-session',
          label: 'Delete me',
          customLabel: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    }

    act(() => {
      root.render(
        <ConfirmationDialogContext.Provider value={confirmDeletion}>
          <SidebarSessionSection />
        </ConfirmationDialogContext.Provider>
      )
    })
    const deleteButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Delete temporary session"]'
    )

    await act(async () => {
      deleteButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.deleteTemporarySession).toHaveBeenCalledWith({
      ownerBucketKey: FLOATING_TERMINAL_WORKTREE_ID,
      sessionId: 'delete-session',
      unifiedTabId: 'delete-tab',
      terminalTabId: null,
      tabId: 'delete-tab',
      paneKey: null,
      executionHostId: null
    })
  })
})
