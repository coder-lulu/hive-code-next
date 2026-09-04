import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../../shared/constants'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import {
  sanitizePersistedTerminalSessionForStartup,
  startPersistedTerminalSessionSanitization,
  STARTUP_PTY_LIVENESS_TOTAL_TIMEOUT_MS,
  STARTUP_PTY_LIVENESS_TIMEOUT_MS
} from './sanitize-persisted-terminal-session'

const WORKTREE_ID = 'repo-1::/worktree'

function terminalTab(id: string, ptyId: string | null): TerminalTab {
  return {
    id,
    ptyId,
    worktreeId: WORKTREE_ID,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function sessionWithPersistedPtys(): WorkspaceSessionState {
  return {
    ...getDefaultWorkspaceSession(),
    activeWorktreeId: WORKTREE_ID,
    tabsByWorktree: {
      [WORKTREE_ID]: [
        terminalTab('dead-tab', 'dead-pty'),
        terminalTab('live-tab', 'live-pty'),
        terminalTab('unknown-tab', 'remote:host@@pty-1')
      ]
    },
    terminalLayoutsByTabId: {
      'dead-tab': {
        root: { type: 'leaf', leafId: 'dead-leaf' },
        activeLeafId: 'dead-leaf',
        expandedLeafId: null,
        ptyIdsByLeafId: { 'dead-leaf': 'dead-pty' }
      },
      'live-tab': {
        root: { type: 'leaf', leafId: 'live-leaf' },
        activeLeafId: 'live-leaf',
        expandedLeafId: null,
        ptyIdsByLeafId: { 'live-leaf': 'live-pty' }
      }
    },
    remoteSessionIdsByTabId: {
      'dead-tab': 'dead-pty',
      'unknown-tab': 'remote:host@@pty-1'
    }
  }
}

describe('sanitizePersistedTerminalSessionForStartup', () => {
  it('clears explicitly dead bindings while preserving live and unknown sessions', async () => {
    const session = sessionWithPersistedPtys()
    const resolveLiveness = vi.fn(async (ptyId: string): Promise<boolean | null> => {
      if (ptyId === 'dead-pty') {
        return false
      }
      if (ptyId === 'live-pty') {
        return true
      }
      return null
    })

    const sanitized = await sanitizePersistedTerminalSessionForStartup(session, resolveLiveness)

    expect(sanitized.tabsByWorktree[WORKTREE_ID]).toEqual([
      expect.objectContaining({ id: 'dead-tab', ptyId: null }),
      expect.objectContaining({ id: 'live-tab', ptyId: 'live-pty' }),
      expect.objectContaining({ id: 'unknown-tab', ptyId: 'remote:host@@pty-1' })
    ])
    expect(sanitized.terminalLayoutsByTabId['dead-tab']?.ptyIdsByLeafId).toEqual({})
    expect(sanitized.terminalLayoutsByTabId['live-tab']?.ptyIdsByLeafId).toEqual({
      'live-leaf': 'live-pty'
    })
    expect(sanitized.remoteSessionIdsByTabId).toEqual({
      'unknown-tab': 'remote:host@@pty-1'
    })
    expect(session.tabsByWorktree[WORKTREE_ID][0]?.ptyId).toBe('dead-pty')
    expect(resolveLiveness).toHaveBeenCalledTimes(3)
  })

  it('does not change a session when every probe is unknown', async () => {
    const session = sessionWithPersistedPtys()
    const sanitized = await sanitizePersistedTerminalSessionForStartup(session, async () => null)

    expect(sanitized).toBe(session)
  })

  it('starts probing without making callers await provider authority before hydration', async () => {
    const session = sessionWithPersistedPtys()
    let resolveProbe: ((verdict: boolean | null) => void) | undefined
    const pendingVerdict = new Promise<boolean | null>((resolve) => {
      resolveProbe = resolve
    })
    const sanitization = startPersistedTerminalSessionSanitization(session, () => pendingVerdict)

    expect(sanitization.readCompleted()).toBeNull()
    resolveProbe?.(false)
    const sanitized = await sanitization.completion
    expect(sanitization.readCompleted()).toBe(sanitized)
  })

  it('waits past the old two-second window for provider authority', async () => {
    vi.useFakeTimers()
    try {
      const session = sessionWithPersistedPtys()
      let resolveDeadProbe: ((verdict: boolean) => void) | undefined
      const resolveLiveness = vi.fn((ptyId: string): Promise<boolean | null> => {
        if (ptyId !== 'dead-pty') {
          return Promise.resolve(true)
        }
        return new Promise((resolve) => {
          resolveDeadProbe = resolve
        })
      })

      let settled = false
      const sanitizing = sanitizePersistedTerminalSessionForStartup(session, resolveLiveness).then(
        (value) => {
          settled = true
          return value
        }
      )
      await vi.advanceTimersByTimeAsync(2_001)
      expect(STARTUP_PTY_LIVENESS_TIMEOUT_MS).toBeGreaterThan(2_001)
      expect(settled).toBe(false)

      resolveDeadProbe?.(false)
      const sanitized = await sanitizing
      expect(sanitized.tabsByWorktree[WORKTREE_ID]?.[0]?.ptyId).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps completed dead verdicts and stops scheduling probes at the total deadline', async () => {
    vi.useFakeTimers()
    try {
      const tabs = Array.from({ length: 40 }, (_, index) =>
        terminalTab(`tab-${index}`, `pty-${index}`)
      )
      const session: WorkspaceSessionState = {
        ...getDefaultWorkspaceSession(),
        tabsByWorktree: { [WORKTREE_ID]: tabs }
      }
      const calls: string[] = []
      const resolveLiveness = vi.fn((ptyId: string): Promise<boolean | null> => {
        calls.push(ptyId)
        return ptyId === 'pty-0' ? Promise.resolve(false) : new Promise(() => {})
      })

      const sanitizing = sanitizePersistedTerminalSessionForStartup(session, resolveLiveness)
      await vi.advanceTimersByTimeAsync(STARTUP_PTY_LIVENESS_TOTAL_TIMEOUT_MS)
      const sanitized = await sanitizing

      expect(sanitized.tabsByWorktree[WORKTREE_ID]?.[0]?.ptyId).toBeNull()
      expect(calls.length).toBeLessThan(tabs.length)
      const callCountAtReturn = calls.length
      await vi.advanceTimersByTimeAsync(STARTUP_PTY_LIVENESS_TIMEOUT_MS * 2)
      expect(calls).toHaveLength(callCountAtReturn)
    } finally {
      vi.useRealTimers()
    }
  })
})
