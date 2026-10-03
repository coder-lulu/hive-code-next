import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { useAppStore } from '@/store'
import {
  activateTemporarySessionInMain,
  applyTemporarySessionMainActivation,
  resolveTemporarySessionOwner
} from './temporary-session-navigation'

describe('temporary session main navigation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('activates the synthetic workspace and requested tab in the main workbench', () => {
    const state = {
      setActiveRepo: vi.fn(),
      setActiveView: vi.fn(),
      setActiveWorktree: vi.fn(),
      activateTab: vi.fn(),
      setActiveTab: vi.fn(),
      setActiveTabType: vi.fn()
    }

    applyTemporarySessionMainActivation(state as never, 'tab-1')

    expect(state.setActiveRepo).toHaveBeenCalledWith(null)
    expect(state.setActiveView).toHaveBeenCalledWith('terminal')
    expect(state.setActiveWorktree).toHaveBeenCalledWith(
      FLOATING_TERMINAL_WORKTREE_ID,
      LOCAL_EXECUTION_HOST_ID
    )
    expect(state.activateTab).toHaveBeenCalledWith('tab-1', {
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID
    })
    expect(state.setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(state.setActiveTabType).toHaveBeenCalledWith('terminal', FLOATING_TERMINAL_WORKTREE_ID)
  })

  it('resolves a restored structured session by its distinct tab identities', () => {
    const ownerBucketKey = `runtime:environment-a|${FLOATING_TERMINAL_WORKTREE_ID}`
    const owner = resolveTemporarySessionOwner(
      {
        unifiedTabsByWorktree: {
          [ownerBucketKey]: [
            {
              id: 'unified-agent-tab',
              entityId: 'provider-session',
              groupId: 'group-1',
              worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
              executionHostId: 'runtime:environment-a',
              contentType: 'agent-session',
              structuredSessionId: 'provider-session',
              label: 'Temporary investigation',
              customLabel: null,
              color: null,
              sortOrder: 0,
              createdAt: 100
            }
          ]
        },
        tabsByWorktree: {
          [ownerBucketKey]: [
            {
              id: 'terminal-pane-tab',
              ptyId: null,
              worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
              title: 'Temporary investigation',
              customTitle: null,
              color: null,
              sortOrder: 0,
              createdAt: 100,
              aiVaultTitle: {
                agent: 'codex',
                title: 'Temporary investigation',
                sessionId: 'provider-session'
              }
            }
          ]
        }
      },
      {
        ownerBucketKey,
        sessionId: 'provider-session',
        unifiedTabId: 'unified-agent-tab',
        terminalTabId: 'terminal-pane-tab',
        executionHostId: 'runtime:environment-a'
      }
    )

    expect(owner).toMatchObject({
      bucketKey: ownerBucketKey,
      executionHostId: 'runtime:environment-a',
      structured: true,
      unifiedTabId: 'unified-agent-tab',
      terminalTabId: 'terminal-pane-tab'
    })
  })

  it('activates the exact host-qualified owner bucket', () => {
    const state = {
      setActiveRepo: vi.fn(),
      setActiveView: vi.fn(),
      setActiveWorktree: vi.fn(),
      activateTab: vi.fn(),
      setActiveTab: vi.fn(),
      setActiveTabType: vi.fn()
    }
    const ownerBucketKey = `runtime:environment-a|${FLOATING_TERMINAL_WORKTREE_ID}`

    applyTemporarySessionMainActivation(state as never, 'tab-1', {
      bucketKey: ownerBucketKey,
      executionHostId: 'runtime:environment-a'
    })

    expect(state.setActiveWorktree).toHaveBeenCalledWith(ownerBucketKey, 'runtime:environment-a')
    expect(state.activateTab).toHaveBeenCalledWith('tab-1', { worktreeId: ownerBucketKey })
  })

  it('refuses a same-id session that is ambiguous across remote hosts', () => {
    const makeTab = () => ({
      id: 'same-tab',
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      title: 'Temporary task',
      customTitle: null,
      color: null,
      sortOrder: 0,
      createdAt: 100,
      ptyId: null
    })

    expect(
      resolveTemporarySessionOwner(
        {
          tabsByWorktree: {
            'runtime:a|global-floating-terminal': [makeTab()],
            'runtime:b|global-floating-terminal': [makeTab()]
          },
          unifiedTabsByWorktree: {}
        },
        'same-tab'
      )
    ).toBeNull()
  })

  it('refuses a same-id session shared by local and remote hosts without an owner hint', () => {
    const tab = (worktreeId: string) => ({
      id: 'same-tab',
      worktreeId,
      title: 'Temporary task',
      customTitle: null,
      color: null,
      sortOrder: 0,
      createdAt: 100,
      ptyId: null
    })

    expect(
      resolveTemporarySessionOwner(
        {
          tabsByWorktree: {
            [FLOATING_TERMINAL_WORKTREE_ID]: [tab(FLOATING_TERMINAL_WORKTREE_ID)],
            'runtime:a|global-floating-terminal': [tab(FLOATING_TERMINAL_WORKTREE_ID)]
          },
          unifiedTabsByWorktree: {}
        },
        'same-tab'
      )
    ).toBeNull()
  })

  it('prefers the host-qualified owner over its raw compatibility mirror', () => {
    const qualifiedBucket = `runtime:environment-a|${FLOATING_TERMINAL_WORKTREE_ID}`
    const unifiedTab = {
      id: 'same-tab',
      entityId: 'terminal-pane-tab',
      groupId: 'group-1',
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      executionHostId: 'runtime:environment-a' as const,
      contentType: 'terminal' as const,
      label: 'Temporary task',
      customLabel: null,
      color: null,
      sortOrder: 0,
      createdAt: 100
    }

    expect(
      resolveTemporarySessionOwner(
        {
          tabsByWorktree: {},
          unifiedTabsByWorktree: {
            [FLOATING_TERMINAL_WORKTREE_ID]: [unifiedTab],
            [qualifiedBucket]: [unifiedTab]
          }
        },
        { tabId: 'same-tab', executionHostId: 'runtime:environment-a' }
      )
    ).toMatchObject({
      bucketKey: qualifiedBucket,
      executionHostId: 'runtime:environment-a'
    })
  })

  it('uses tab host metadata when a remote mirror is stored in the canonical bucket', () => {
    expect(
      resolveTemporarySessionOwner(
        {
          tabsByWorktree: {},
          unifiedTabsByWorktree: {
            [FLOATING_TERMINAL_WORKTREE_ID]: [
              {
                id: 'unified-terminal-tab',
                entityId: 'terminal-pane-tab',
                groupId: 'group-1',
                worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
                executionHostId: 'runtime:environment-a',
                contentType: 'terminal',
                label: 'Temporary task',
                customLabel: null,
                color: null,
                sortOrder: 0,
                createdAt: 100
              }
            ]
          }
        },
        {
          ownerBucketKey: FLOATING_TERMINAL_WORKTREE_ID,
          unifiedTabId: 'unified-terminal-tab',
          executionHostId: 'runtime:environment-a'
        }
      )
    ).toMatchObject({
      bucketKey: FLOATING_TERMINAL_WORKTREE_ID,
      executionHostId: 'runtime:environment-a',
      unifiedTabId: 'unified-terminal-tab',
      terminalTabId: 'terminal-pane-tab'
    })
  })

  it('restores the exact remote bucket, unified tab, and terminal pane together', () => {
    const ownerBucketKey = `runtime:environment-a|${FLOATING_TERMINAL_WORKTREE_ID}`
    const state = {
      tabsByWorktree: {
        [ownerBucketKey]: [{ id: 'terminal-pane-tab' }]
      },
      unifiedTabsByWorktree: {
        [ownerBucketKey]: [
          {
            id: 'unified-terminal-tab',
            entityId: 'terminal-pane-tab',
            contentType: 'terminal'
          }
        ]
      },
      setActiveRepo: vi.fn(),
      setActiveView: vi.fn(),
      setActiveWorktree: vi.fn(),
      activateTab: vi.fn(),
      setActiveTab: vi.fn(),
      setActiveTabType: vi.fn()
    }
    vi.spyOn(useAppStore, 'getState').mockReturnValue(state as never)
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })

    expect(
      activateTemporarySessionInMain({
        ownerBucketKey,
        unifiedTabId: 'unified-terminal-tab',
        terminalTabId: 'terminal-pane-tab',
        executionHostId: 'runtime:environment-a'
      })
    ).toBe(true)

    expect(state.setActiveWorktree).toHaveBeenCalledWith(ownerBucketKey, 'runtime:environment-a')
    expect(state.activateTab).toHaveBeenCalledWith('unified-terminal-tab', {
      worktreeId: ownerBucketKey
    })
    expect(state.setActiveTab).toHaveBeenCalledWith('terminal-pane-tab')
    expect(state.setActiveTabType).toHaveBeenCalledWith('terminal', ownerBucketKey)
    expect(dispatchEvent).toHaveBeenCalledOnce()
  })

  it('activates the unified tab created while a legacy session bucket is reconciled', () => {
    const terminalTab = {
      id: 'legacy-terminal-tab',
      ptyId: null,
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      title: 'Restored task',
      customTitle: null,
      color: null,
      sortOrder: 0,
      createdAt: 100,
      aiVaultTitle: {
        agent: 'codex',
        title: 'Restored task',
        sessionId: 'provider-session'
      }
    }
    const state = {
      tabsByWorktree: { [FLOATING_TERMINAL_WORKTREE_ID]: [terminalTab] },
      unifiedTabsByWorktree: { [FLOATING_TERMINAL_WORKTREE_ID]: [] as unknown[] },
      setActiveRepo: vi.fn(),
      setActiveView: vi.fn(),
      setActiveWorktree: vi.fn(() => {
        state.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] = [
          {
            id: 'reconciled-unified-tab',
            entityId: terminalTab.id,
            groupId: 'group-1',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            executionHostId: LOCAL_EXECUTION_HOST_ID,
            contentType: 'terminal',
            label: terminalTab.title,
            customLabel: null,
            color: null,
            sortOrder: 0,
            createdAt: terminalTab.createdAt,
            aiVaultTitle: terminalTab.aiVaultTitle
          }
        ]
      }),
      activateTab: vi.fn(),
      setActiveTab: vi.fn(),
      setActiveTabType: vi.fn()
    }
    vi.spyOn(useAppStore, 'getState').mockImplementation(() => state as never)
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })

    expect(
      activateTemporarySessionInMain({
        ownerBucketKey: FLOATING_TERMINAL_WORKTREE_ID,
        sessionId: 'provider-session',
        terminalTabId: terminalTab.id,
        executionHostId: LOCAL_EXECUTION_HOST_ID
      })
    ).toBe(true)

    expect(state.activateTab).toHaveBeenCalledWith('reconciled-unified-tab', {
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID
    })
    expect(state.setActiveTab).toHaveBeenCalledWith(terminalTab.id)
  })
})
