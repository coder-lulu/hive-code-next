import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'

const mocks = vi.hoisted(() => ({
  state: {
    tabsByWorktree: {} as Record<string, unknown[]>,
    unifiedTabsByWorktree: {} as Record<string, unknown[]>,
    closeUnifiedTab: vi.fn(),
    dropAgentStatus: vi.fn()
  },
  closeTerminalTab: vi.fn(),
  buildTerminalTabRetirementPlan: vi.fn(),
  guardPinnedTabClose: vi.fn(),
  resolvePinnedTabLabel: vi.fn(),
  closeStructuredAgentSession: vi.fn(),
  callRuntimeRpc: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mocks.state
  }
}))

vi.mock('@/components/terminal/terminal-tab-actions', () => ({
  closeTerminalTab: mocks.closeTerminalTab
}))

vi.mock('@/store/slices/terminal-tab-retirement', () => ({
  buildTerminalTabRetirementPlan: mocks.buildTerminalTabRetirementPlan
}))

vi.mock('@/store/pinned-tab-close-guard', () => ({
  guardPinnedTabClose: mocks.guardPinnedTabClose,
  resolvePinnedTabLabel: mocks.resolvePinnedTabLabel
}))

vi.mock('@/runtime/structured-agent-session-close', () => ({
  closeStructuredAgentSession: mocks.closeStructuredAgentSession
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc
}))

import { deleteTemporarySession } from './temporary-session-actions'

describe('temporary session deletion', () => {
  beforeEach(() => {
    mocks.state.tabsByWorktree = {}
    mocks.state.unifiedTabsByWorktree = {}
    mocks.state.closeUnifiedTab.mockReset()
    mocks.state.dropAgentStatus.mockReset()
    mocks.closeTerminalTab.mockReset()
    mocks.buildTerminalTabRetirementPlan
      .mockReset()
      .mockImplementation((_state, tabId: string) => ({
        tabId,
        worktreeId: Object.keys(_state.tabsByWorktree)[0] ?? null,
        ptyIds: [],
        localOrSshPtyIds: [],
        runtimeTerminals: [],
        cleanupOnlyPtyIds: [],
        sharedPtyIds: [],
        unroutablePtyIds: []
      }))
    mocks.closeStructuredAgentSession.mockReset().mockResolvedValue(undefined)
    mocks.callRuntimeRpc.mockReset().mockResolvedValue(undefined)
    mocks.guardPinnedTabClose.mockReset().mockImplementation(({ onClose }) => onClose())
    mocks.resolvePinnedTabLabel.mockReset().mockReturnValue('Temporary investigation')
  })

  it('closes a workspace session only when explicitly allowed with an exact bucket and host', async () => {
    mocks.state.tabsByWorktree = {
      'folder:notes': [{ id: 'terminal', worktreeId: 'folder:notes', executionHostId: 'local' }]
    }
    const target = {
      ownerBucketKey: 'folder:notes',
      terminalTabId: 'terminal',
      executionHostId: 'local' as const
    }
    expect(await deleteTemporarySession(target)).toBe(false)
    expect(mocks.closeTerminalTab).not.toHaveBeenCalled()
    expect(await deleteTemporarySession(target, { allowWorkspaceOwner: true })).toBe(true)
    expect(mocks.closeTerminalTab).toHaveBeenCalledWith(
      'terminal',
      expect.objectContaining({
        precomputedCloseState: expect.objectContaining({ owningWorktreeId: 'folder:notes' })
      })
    )
    mocks.closeTerminalTab.mockClear()
    expect(
      await deleteTemporarySession(
        { ...target, executionHostId: 'ssh:wrong' },
        { allowWorkspaceOwner: true }
      )
    ).toBe(false)
    expect(mocks.closeTerminalTab).not.toHaveBeenCalled()
  })

  it('closes the terminal identity instead of guessing from the unified tab id', async () => {
    const ownerBucketKey = `runtime:environment-a|${FLOATING_TERMINAL_WORKTREE_ID}`
    const otherBucketKey = `runtime:environment-b|${FLOATING_TERMINAL_WORKTREE_ID}`
    mocks.state.tabsByWorktree = {
      [ownerBucketKey]: [
        {
          id: 'terminal-pane-tab',
          worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
          aiVaultTitle: { sessionId: 'provider-session' }
        }
      ],
      [otherBucketKey]: [
        {
          id: 'terminal-pane-tab',
          worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
          aiVaultTitle: { sessionId: 'other-provider-session' }
        }
      ]
    }
    mocks.state.unifiedTabsByWorktree = {
      [ownerBucketKey]: [
        {
          id: 'unified-terminal-tab',
          entityId: 'terminal-pane-tab',
          contentType: 'terminal'
        }
      ],
      [otherBucketKey]: [
        {
          id: 'other-unified-terminal-tab',
          entityId: 'terminal-pane-tab',
          contentType: 'terminal'
        }
      ]
    }

    await expect(
      deleteTemporarySession({
        ownerBucketKey,
        sessionId: 'provider-session',
        unifiedTabId: 'unified-terminal-tab',
        terminalTabId: 'terminal-pane-tab',
        executionHostId: 'runtime:environment-a'
      })
    ).resolves.toBe(true)

    expect(mocks.closeTerminalTab).toHaveBeenCalledWith(
      'terminal-pane-tab',
      expect.objectContaining({
        precomputedRetirementPlan: expect.objectContaining({
          tabId: 'terminal-pane-tab',
          worktreeId: ownerBucketKey
        }),
        precomputedCloseState: {
          owningWorktreeId: ownerBucketKey,
          terminalCountBeforeClose: 1,
          nextTerminalTabId: null
        }
      })
    )
    expect(mocks.buildTerminalTabRetirementPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        tabsByWorktree: { [ownerBucketKey]: expect.any(Array) },
        unifiedTabsByWorktree: { [ownerBucketKey]: expect.any(Array) }
      }),
      'terminal-pane-tab'
    )
    expect(mocks.state.closeUnifiedTab).not.toHaveBeenCalled()
  })

  it('retires a structured session before pruning its unified tab', async () => {
    mocks.state.unifiedTabsByWorktree = {
      [FLOATING_TERMINAL_WORKTREE_ID]: [
        {
          id: 'unified-agent-tab',
          entityId: 'provider-session',
          contentType: 'agent-session',
          structuredSessionId: 'provider-session'
        }
      ]
    }

    await expect(
      deleteTemporarySession({
        ownerBucketKey: FLOATING_TERMINAL_WORKTREE_ID,
        sessionId: 'provider-session',
        unifiedTabId: 'unified-agent-tab',
        executionHostId: 'local'
      })
    ).resolves.toBe(true)

    expect(mocks.closeStructuredAgentSession).toHaveBeenCalledWith(
      { kind: 'local' },
      'provider-session'
    )
    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith({ kind: 'local' }, 'session.tabs.close', {
      worktree: `id:${FLOATING_TERMINAL_WORKTREE_ID}`,
      tabId: 'agent-session:provider-session',
      reason: 'user'
    })
    expect(mocks.state.closeUnifiedTab).toHaveBeenCalledWith('unified-agent-tab')
  })

  it('keeps a pinned structured session when the user cancels deletion', async () => {
    mocks.state.unifiedTabsByWorktree = {
      [FLOATING_TERMINAL_WORKTREE_ID]: [
        {
          id: 'unified-agent-tab',
          entityId: 'provider-session',
          contentType: 'agent-session',
          structuredSessionId: 'provider-session',
          isPinned: true
        }
      ]
    }
    mocks.guardPinnedTabClose.mockImplementation(({ onCancel }) => onCancel())

    await expect(
      deleteTemporarySession({
        ownerBucketKey: FLOATING_TERMINAL_WORKTREE_ID,
        sessionId: 'provider-session',
        unifiedTabId: 'unified-agent-tab',
        executionHostId: 'local'
      })
    ).resolves.toBe(true)

    expect(mocks.guardPinnedTabClose).toHaveBeenCalledWith(
      expect.objectContaining({
        isPinned: true,
        tabLabel: 'Temporary investigation'
      })
    )
    expect(mocks.closeStructuredAgentSession).not.toHaveBeenCalled()
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
    expect(mocks.state.closeUnifiedTab).not.toHaveBeenCalled()
  })

  it('deletes an orphaned retained row that no longer has a restorable tab', async () => {
    await expect(
      deleteTemporarySession({
        sessionId: 'stale-session',
        tabId: 'stale-tab',
        paneKey: 'stale-tab:00000000-0000-4000-8000-000000000001'
      })
    ).resolves.toBe(true)

    expect(mocks.state.dropAgentStatus).toHaveBeenCalledWith(
      'stale-tab:00000000-0000-4000-8000-000000000001'
    )
  })
})
