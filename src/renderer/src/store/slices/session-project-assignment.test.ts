import { describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/runtime/sync-runtime-graph', () => ({ scheduleRuntimeGraphSync: vi.fn() }))
vi.mock('@/components/terminal-pane/pty-transport', () => ({
  registerEagerPtyBuffer: vi.fn(),
  ensurePtyDispatcher: vi.fn(),
  unregisterPtyDataHandlers: vi.fn()
}))
vi.mock('@/components/terminal-pane/shutdown-buffer-captures', () => ({
  shutdownBufferCaptures: vi.fn()
}))

// @ts-expect-error -- minimal preload API stub for the slice's IPC writes
globalThis.window = { api: {} }

import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { createTestStore, makeTab, makeUnifiedTab, seedStore } from './store-test-helpers'

describe('setSessionProjectAssignment', () => {
  it('updates and clears both persisted tab representations without changing ownership', () => {
    const store = createTestStore()
    seedStore(store, {
      tabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          makeTab({ id: 'tab-1', worktreeId: FLOATING_TERMINAL_WORKTREE_ID })
        ]
      },
      unifiedTabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          makeUnifiedTab({
            id: 'tab-1',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            groupId: 'group-1'
          })
        ]
      }
    })
    const assignment = {
      projectId: 'project-1',
      projectIdentityKey: 'local|project:project-1',
      projectGroupId: 'space-1',
      executionHostId: 'local' as const,
      assignedAt: 10
    }

    store.getState().setSessionProjectAssignment(FLOATING_TERMINAL_WORKTREE_ID, 'tab-1', assignment)

    expect(store.getState().tabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.[0]).toMatchObject({
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      projectAssignment: assignment
    })
    expect(
      store.getState().unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.[0]
    ).toMatchObject({
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      projectAssignment: assignment
    })

    store.getState().setSessionProjectAssignment(FLOATING_TERMINAL_WORKTREE_ID, 'tab-1', null)

    expect(
      store.getState().tabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.[0]?.projectAssignment
    ).toBeUndefined()
    expect(
      store.getState().unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.[0]?.projectAssignment
    ).toBeUndefined()
  })

  it('updates only the requested host-qualified bucket when tab ids collide', () => {
    const store = createTestStore()
    const remoteBucket = `runtime:cloud-a|${FLOATING_TERMINAL_WORKTREE_ID}`
    seedStore(store, {
      tabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          makeTab({ id: 'same-tab', worktreeId: FLOATING_TERMINAL_WORKTREE_ID })
        ],
        [remoteBucket]: [makeTab({ id: 'same-tab', worktreeId: FLOATING_TERMINAL_WORKTREE_ID })]
      },
      unifiedTabsByWorktree: {}
    })
    const assignment = {
      projectId: 'remote-project',
      projectIdentityKey: 'runtime:cloud-a|project:remote-project',
      projectGroupId: 'remote-space',
      executionHostId: 'runtime:cloud-a' as const,
      assignedAt: 20
    }

    store.getState().setSessionProjectAssignment(remoteBucket, 'same-tab', assignment)

    expect(store.getState().tabsByWorktree[remoteBucket]?.[0]?.projectAssignment).toEqual(
      assignment
    )
    expect(
      store.getState().tabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.[0]?.projectAssignment
    ).toBeUndefined()
  })

  it('synchronizes linked unified and terminal tabs when their ids differ', () => {
    const store = createTestStore()
    seedStore(store, {
      tabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          makeTab({ id: 'terminal-1', worktreeId: FLOATING_TERMINAL_WORKTREE_ID })
        ]
      },
      unifiedTabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          makeUnifiedTab({
            id: 'unified-1',
            entityId: 'terminal-1',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            groupId: 'group-1'
          })
        ]
      }
    })
    const assignment = {
      projectId: 'project-1',
      projectIdentityKey: 'local|project:project-1',
      projectGroupId: 'space-1',
      executionHostId: 'local' as const,
      assignedAt: 30
    }

    store
      .getState()
      .setSessionProjectAssignment(FLOATING_TERMINAL_WORKTREE_ID, 'unified-1', assignment)

    expect(
      store.getState().tabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.[0]?.projectAssignment
    ).toEqual(assignment)
    expect(
      store.getState().unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.[0]?.projectAssignment
    ).toEqual(assignment)
  })

  it('atomically updates and clears a structured session and its legacy terminal mirror', () => {
    const store = createTestStore()
    seedStore(store, {
      tabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          makeTab({
            id: 'terminal-mirror',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            aiVaultTitle: {
              agent: 'codex',
              sessionId: 'provider-session',
              title: 'Structured session'
            }
          })
        ]
      },
      unifiedTabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          makeUnifiedTab({
            id: 'unified-agent-session',
            entityId: 'provider-session',
            structuredSessionId: 'provider-session',
            contentType: 'agent-session',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            groupId: 'group-1'
          })
        ]
      }
    })
    const assignment = {
      projectId: 'project-1',
      projectIdentityKey: 'local|project:project-1',
      projectGroupId: 'space-1',
      executionHostId: 'local' as const,
      assignedAt: 40
    }
    const assign = (nextAssignment: typeof assignment | null): void =>
      store
        .getState()
        .setSessionProjectAssignment(
          FLOATING_TERMINAL_WORKTREE_ID,
          'unified-agent-session',
          nextAssignment,
          ['terminal-mirror']
        )

    assign(assignment)

    expect(
      store.getState().tabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.[0]?.projectAssignment
    ).toEqual(assignment)
    expect(
      store.getState().unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.[0]?.projectAssignment
    ).toEqual(assignment)

    assign(null)

    expect(
      store.getState().tabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.[0]?.projectAssignment
    ).toBeUndefined()
    expect(
      store.getState().unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.[0]?.projectAssignment
    ).toBeUndefined()
  })
})
