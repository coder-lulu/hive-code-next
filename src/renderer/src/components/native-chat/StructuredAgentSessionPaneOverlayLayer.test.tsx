import { setActivityTerminalPortals } from '../activity/activity-terminal-portal'
// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'

type MockAppState = {
  activeView: 'terminal' | 'sessions'
  sessionsView: { selectedSessionKey: string | null }
  unifiedTabsByWorktree: Record<string, readonly Tab[]>
  groupsByWorktree: Record<string, readonly TabGroup[]>
  activeGroupIdByWorktree: Record<string, string>
  runtimeEnvironmentId: string | null
  repos: []
  worktreesByRepo: Record<
    string,
    { id: string; repoId: string; hostId: 'local' | 'runtime:cloud' }[]
  >
  folderWorkspaces: []
  projectGroups: []
  focusGroup: (worktreeId: string, groupId: string) => void
}

vi.hoisted(() => {
  vi.stubGlobal('CSS', { supports: () => true })
})

const mocks = vi.hoisted(() => ({
  store: null as null | { setState: (state: Partial<MockAppState>) => void },
  focusGroup: vi.fn(),
  mountsByTabId: new Map<string, number>(),
  unmountsByTabId: new Map<string, number>(),
  targetByTabId: new Map<string, RuntimeClientTarget>(),
  groupIdByTabId: new Map<string, string | undefined>()
}))

vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  const useAppStore = create<MockAppState>(() => ({
    activeView: 'terminal',
    sessionsView: { selectedSessionKey: null },
    unifiedTabsByWorktree: {},
    groupsByWorktree: {},
    activeGroupIdByWorktree: {},
    runtimeEnvironmentId: null,
    repos: [],
    worktreesByRepo: {},
    folderWorkspaces: [],
    projectGroups: [],
    focusGroup: mocks.focusGroup
  }))
  mocks.store = useAppStore
  return { useAppStore }
})

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: (state: MockAppState) => state.runtimeEnvironmentId
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({
  getActiveRuntimeTarget: ({
    activeRuntimeEnvironmentId
  }: {
    activeRuntimeEnvironmentId: string | null
  }) =>
    activeRuntimeEnvironmentId
      ? { kind: 'environment', environmentId: activeRuntimeEnvironmentId }
      : { kind: 'local' }
}))

vi.mock('./NativeChatView', async () => {
  const { useEffect } = await import('react')
  return {
    default: function MockNativeChatView({
      tabId,
      groupId,
      isVisible,
      isFocusedGroup,
      target
    }: {
      tabId: string
      groupId?: string
      isVisible: boolean
      isFocusedGroup: boolean
      target: RuntimeClientTarget
    }) {
      mocks.groupIdByTabId.set(tabId, groupId)
      mocks.targetByTabId.set(tabId, target)
      useEffect(() => {
        mocks.mountsByTabId.set(tabId, (mocks.mountsByTabId.get(tabId) ?? 0) + 1)
        return () => {
          mocks.unmountsByTabId.set(tabId, (mocks.unmountsByTabId.get(tabId) ?? 0) + 1)
        }
      }, [tabId, target])
      return (
        <input
          data-chat-tab-id={tabId}
          data-chat-visible={String(isVisible)}
          data-chat-focused-group={String(isFocusedGroup)}
          data-chat-target={target.kind === 'environment' ? target.environmentId : target.kind}
          data-native-chat-working="true"
        />
      )
    }
  }
})

import StructuredAgentSessionPaneOverlayLayer from './StructuredAgentSessionPaneOverlayLayer'

const WORKTREE_ID = 'wt-1'
const GROUP_ID = 'group-1'
const SECOND_GROUP_ID = 'group-2'
const FIRST_TAB_ID = 'structured-agent-session-session-1'
const SECOND_TAB_ID = 'structured-agent-session-session-2'

describe('StructuredAgentSessionPaneOverlayLayer', () => {
  it('isolates retained chat panes and reports the active split group', () => {
    const state = createState(FIRST_TAB_ID)
    mocks.store?.setState({
      unifiedTabsByWorktree: {
        [WORKTREE_ID]: state.unifiedTabsByWorktree[WORKTREE_ID].map((tab) =>
          tab.id === SECOND_TAB_ID ? { ...tab, groupId: SECOND_GROUP_ID } : tab
        )
      },
      groupsByWorktree: {
        [WORKTREE_ID]: [
          { ...createGroup(FIRST_TAB_ID), tabOrder: [FIRST_TAB_ID] },
          { ...createGroup(SECOND_TAB_ID), id: SECOND_GROUP_ID, tabOrder: [SECOND_TAB_ID] }
        ]
      }
    })
    const view = render(
      <StructuredAgentSessionPaneOverlayLayer worktreeId={WORKTREE_ID} isWorktreeActive />
    )
    const slot = view.baseElement.querySelector<HTMLElement>(
      `[data-structured-agent-session-overlay-tab-id="${FIRST_TAB_ID}"]`
    )!
    expect(slot.hasAttribute('data-retained-pane-host')).toBe(true)
    expect(slot.classList.contains('isolate')).toBe(true)
    expect(slot.classList.contains('overflow-hidden')).toBe(true)
    expect(chatSurface(view.baseElement, FIRST_TAB_ID).dataset.chatFocusedGroup).toBe('true')
    expect(chatSurface(view.baseElement, SECOND_TAB_ID).dataset.chatVisible).toBe('true')
    expect(chatSurface(view.baseElement, SECOND_TAB_ID).dataset.chatFocusedGroup).toBe('false')
    act(() =>
      mocks.store?.setState({ activeGroupIdByWorktree: { [WORKTREE_ID]: SECOND_GROUP_ID } })
    )
    expect(chatSurface(view.baseElement, FIRST_TAB_ID).dataset.chatFocusedGroup).toBe('false')
    expect(chatSurface(view.baseElement, SECOND_TAB_ID).dataset.chatFocusedGroup).toBe('true')
  })

  beforeEach(() => {
    setActivityTerminalPortals([])
    mocks.focusGroup.mockClear()
    mocks.mountsByTabId.clear()
    mocks.unmountsByTabId.clear()
    mocks.targetByTabId.clear()
    mocks.groupIdByTabId.clear()
    mocks.store?.setState(createState(FIRST_TAB_ID))
  })

  afterEach(cleanup)

  it.each(['local', 'runtime:cloud'] as const)(
    'keeps %s chat controllers stable across activation and tab metadata changes',
    (executionHostId) => {
      const tabs = createState(FIRST_TAB_ID).unifiedTabsByWorktree[WORKTREE_ID].map((tab) => ({
        ...tab,
        executionHostId
      }))
      mocks.store?.setState({ unifiedTabsByWorktree: { [WORKTREE_ID]: tabs } })
      const view = render(
        <StructuredAgentSessionPaneOverlayLayer worktreeId={WORKTREE_ID} isWorktreeActive />
      )
      const firstBefore = chatSurface(view.baseElement, FIRST_TAB_ID)
      const secondBefore = chatSurface(view.baseElement, SECOND_TAB_ID)
      const firstTarget = mocks.targetByTabId.get(FIRST_TAB_ID)

      expect(firstBefore.dataset.chatVisible).toBe('true')
      expect(secondBefore.dataset.chatVisible).toBe('false')
      expect(mocks.mountsByTabId).toEqual(
        new Map([
          [FIRST_TAB_ID, 1],
          [SECOND_TAB_ID, 1]
        ])
      )

      act(() => {
        mocks.store?.setState({
          groupsByWorktree: {
            [WORKTREE_ID]: [createGroup(SECOND_TAB_ID)]
          },
          unifiedTabsByWorktree: {
            [WORKTREE_ID]: tabs.map((tab) => ({ ...tab, label: 'Renamed', lastFocusedAt: 20 }))
          }
        })
      })

      const firstAfter = chatSurface(view.baseElement, FIRST_TAB_ID)
      const secondAfter = chatSurface(view.baseElement, SECOND_TAB_ID)
      expect(firstAfter).toBe(firstBefore)
      expect(secondAfter).toBe(secondBefore)
      expect(firstAfter.dataset.chatVisible).toBe('false')
      expect(secondAfter.dataset.chatVisible).toBe('true')
      expect(mocks.mountsByTabId.get(FIRST_TAB_ID)).toBe(1)
      expect(mocks.mountsByTabId.get(SECOND_TAB_ID)).toBe(1)
      expect(mocks.unmountsByTabId.size).toBe(0)
      expect(mocks.targetByTabId.get(FIRST_TAB_ID)).toBe(firstTarget)
      expect(mocks.groupIdByTabId).toEqual(
        new Map([
          [FIRST_TAB_ID, GROUP_ID],
          [SECOND_TAB_ID, GROUP_ID]
        ])
      )
    }
  )

  it('routes overlay interaction back to the owning split group', () => {
    const view = render(
      <StructuredAgentSessionPaneOverlayLayer worktreeId={WORKTREE_ID} isWorktreeActive />
    )
    const slot = view.baseElement.querySelector<HTMLElement>(
      `[data-structured-agent-session-overlay-tab-id="${FIRST_TAB_ID}"]`
    )

    expect(slot).not.toBeNull()
    fireEvent.pointerDown(slot!)
    expect(mocks.focusGroup).toHaveBeenCalledWith(WORKTREE_ID, GROUP_ID)
  })

  it('keeps the working-chat layer inside the retained pane stacking context', () => {
    const view = render(
      <StructuredAgentSessionPaneOverlayLayer worktreeId={WORKTREE_ID} isWorktreeActive />
    )
    const slot = view.baseElement.querySelector<HTMLElement>(
      `[data-structured-agent-session-overlay-tab-id="${FIRST_TAB_ID}"]`
    )

    expect(slot).not.toBeNull()
    const chatShell = slot?.querySelector<HTMLElement>('.native-chat-pane-shell')
    expect(chatShell).not.toBeNull()
    expect(slot?.classList.contains('isolate')).toBe(true)
    expect(slot?.classList.contains('overflow-hidden')).toBe(true)
    expect(slot?.classList.contains('z-10')).toBe(true)
    expect(slot?.style.zIndex).toBe('')
    expect(chatShell?.classList.contains('z-10')).toBe(true)
    expect(chatShell?.style.zIndex).toBe('')
    expect(chatShell?.querySelector('[data-native-chat-working="true"]')).not.toBeNull()
  })

  it('retains one composer outside the hidden workbench when showing session detail', () => {
    const surface = (active: boolean) => (
      <div hidden={!active} inert={!active}>
        <StructuredAgentSessionPaneOverlayLayer
          worktreeId={WORKTREE_ID}
          isWorktreeActive={active}
        />
      </div>
    )
    const view = render(surface(true))
    const composer = chatSurface(view.baseElement, FIRST_TAB_ID) as HTMLInputElement
    fireEvent.change(composer, { target: { value: 'unsent draft' } })

    act(() => {
      const target = document.createElement('div')
      target.style.setProperty('anchor-name', '--hive-session-detail')
      setActivityTerminalPortals([
        {
          slotId: 'session-detail',
          requestToken: FIRST_TAB_ID,
          target,
          worktreeId: WORKTREE_ID,
          tabId: FIRST_TAB_ID,
          paneKey: '',
          active: true
        }
      ])
      mocks.store?.setState({
        activeView: 'sessions',
        sessionsView: { selectedSessionKey: `${WORKTREE_ID}|${FIRST_TAB_ID}` }
      })
    })
    view.rerender(surface(false))

    expect(chatSurface(view.baseElement, FIRST_TAB_ID)).toBe(composer)
    expect(composer.value).toBe('unsent draft')
    expect(composer.dataset.chatVisible).toBe('true')
    expect(composer.closest('[inert], [hidden]')).toBeNull()
    const slot = composer.closest<HTMLElement>('[data-retained-pane-host]')!
    expect(slot.style.positionAnchor).toBe('--hive-session-detail')
    expect(mocks.groupIdByTabId.get(FIRST_TAB_ID)).toBeUndefined()
    fireEvent.pointerDown(composer)
    fireEvent.focus(composer)
    expect(mocks.focusGroup).not.toHaveBeenCalled()

    act(() => mocks.store?.setState({ activeView: 'terminal' }))
    view.rerender(surface(true))

    expect(chatSurface(view.baseElement, FIRST_TAB_ID)).toBe(composer)
    expect(composer.value).toBe('unsent draft')
    expect(mocks.mountsByTabId.get(FIRST_TAB_ID)).toBe(1)
    expect(mocks.unmountsByTabId.size).toBe(0)
    expect(mocks.groupIdByTabId.get(FIRST_TAB_ID)).toBe(GROUP_ID)
    fireEvent.pointerDown(composer)
    expect(mocks.focusGroup).toHaveBeenCalledWith(WORKTREE_ID, GROUP_ID)
  })

  it('does not select an identically named tab from another owner bucket', () => {
    mocks.store?.setState({
      activeView: 'sessions',
      sessionsView: { selectedSessionKey: `runtime:other|${WORKTREE_ID}|${FIRST_TAB_ID}` }
    })
    const view = render(
      <StructuredAgentSessionPaneOverlayLayer worktreeId={WORKTREE_ID} isWorktreeActive={false} />
    )
    expect(chatSurface(view.baseElement, FIRST_TAB_ID).dataset.chatVisible).toBe('false')
    expect(chatSurface(view.baseElement, SECOND_TAB_ID).dataset.chatVisible).toBe('false')
  })

  it('keeps both projected sessions visible while only the selected split is focused', () => {
    const target = document.createElement('div')
    target.style.setProperty('anchor-name', '--hive-session-detail-split')
    const portals = [FIRST_TAB_ID, SECOND_TAB_ID].map((tabId) => ({
      slotId: `session-detail:${tabId}`,
      requestToken: tabId,
      target,
      worktreeId: WORKTREE_ID,
      tabId,
      paneKey: '',
      active: tabId === FIRST_TAB_ID
    }))
    setActivityTerminalPortals(portals)
    mocks.store?.setState({ activeView: 'sessions' })
    const view = render(
      <StructuredAgentSessionPaneOverlayLayer worktreeId={WORKTREE_ID} isWorktreeActive={false} />
    )

    expect(chatSurface(view.baseElement, FIRST_TAB_ID).dataset.chatVisible).toBe('true')
    expect(chatSurface(view.baseElement, SECOND_TAB_ID).dataset.chatVisible).toBe('true')
    expect(chatSurface(view.baseElement, FIRST_TAB_ID).dataset.chatFocusedGroup).toBe('true')
    expect(chatSurface(view.baseElement, SECOND_TAB_ID).dataset.chatFocusedGroup).toBe('false')

    act(() => {
      setActivityTerminalPortals(
        portals.map((portal) => ({
          ...portal,
          active: portal.tabId === SECOND_TAB_ID
        }))
      )
    })

    expect(chatSurface(view.baseElement, FIRST_TAB_ID).dataset.chatVisible).toBe('true')
    expect(chatSurface(view.baseElement, SECOND_TAB_ID).dataset.chatVisible).toBe('true')
    expect(chatSurface(view.baseElement, FIRST_TAB_ID).dataset.chatFocusedGroup).toBe('false')
    expect(chatSurface(view.baseElement, SECOND_TAB_ID).dataset.chatFocusedGroup).toBe('true')
    expect(mocks.mountsByTabId.get(FIRST_TAB_ID)).toBe(1)
    expect(mocks.mountsByTabId.get(SECOND_TAB_ID)).toBe(1)
  })

  it('hides the former workbench tab immediately when session navigation changes', () => {
    const view = render(
      <StructuredAgentSessionPaneOverlayLayer worktreeId={WORKTREE_ID} isWorktreeActive />
    )
    act(() => {
      const target = document.createElement('div')
      target.style.setProperty('anchor-name', '--hive-session-detail')
      setActivityTerminalPortals([
        {
          slotId: 'session-detail',
          requestToken: SECOND_TAB_ID,
          target,
          worktreeId: WORKTREE_ID,
          tabId: SECOND_TAB_ID,
          paneKey: '',
          active: true
        }
      ])
      mocks.store?.setState({
        activeView: 'sessions',
        sessionsView: { selectedSessionKey: `${WORKTREE_ID}|${SECOND_TAB_ID}` }
      })
    })
    expect(chatSurface(view.baseElement, FIRST_TAB_ID).dataset.chatVisible).toBe('false')
    expect(chatSurface(view.baseElement, SECOND_TAB_ID).dataset.chatVisible).toBe('true')
  })

  it('keeps a qualified session on its explicit runtime despite a different focused environment', () => {
    const ownerBucketKey = `runtime:remote-a|${WORKTREE_ID}`
    const target = document.createElement('div')
    target.style.setProperty('anchor-name', '--hive-session-detail-a')
    setActivityTerminalPortals([
      {
        slotId: 'session-detail:a',
        requestToken: FIRST_TAB_ID,
        target,
        worktreeId: ownerBucketKey,
        tabId: FIRST_TAB_ID,
        paneKey: '',
        active: true
      }
    ])
    mocks.store?.setState({
      activeView: 'sessions',
      sessionsView: { selectedSessionKey: `${ownerBucketKey}|${FIRST_TAB_ID}` },
      unifiedTabsByWorktree: {
        [ownerBucketKey]: [structuredTab(FIRST_TAB_ID, 'session-1', 0)]
      },
      runtimeEnvironmentId: 'focused-elsewhere'
    })
    const view = render(
      <StructuredAgentSessionPaneOverlayLayer
        worktreeId={ownerBucketKey}
        isWorktreeActive={false}
      />
    )
    const composer = chatSurface(view.baseElement, FIRST_TAB_ID)
    expect(composer.dataset.chatVisible).toBe('true')
    expect(composer.dataset.chatTarget).toBe('remote-a')
  })

  it('never routes a direct SSH structured session to the local runtime', () => {
    const ownerBucketKey = `ssh:server-a|${WORKTREE_ID}`
    mocks.store?.setState({
      activeView: 'sessions',
      sessionsView: { selectedSessionKey: `${ownerBucketKey}|${FIRST_TAB_ID}` },
      unifiedTabsByWorktree: {
        [ownerBucketKey]: [structuredTab(FIRST_TAB_ID, 'session-1', 0)]
      }
    })
    const view = render(
      <StructuredAgentSessionPaneOverlayLayer
        worktreeId={ownerBucketKey}
        isWorktreeActive={false}
      />
    )
    expect(view.baseElement.querySelector('[data-chat-tab-id]')).toBeNull()
    expect(mocks.mountsByTabId.size).toBe(0)
  })

  it.each(['runtime:cloud', 'ssh:alpha'] as const)(
    'uses the raw bucket tab owner %s instead of a local fallback',
    (executionHostId) => {
      mocks.store?.setState({
        activeView: 'sessions',
        sessionsView: { selectedSessionKey: `${WORKTREE_ID}|${FIRST_TAB_ID}` },
        unifiedTabsByWorktree: {
          [WORKTREE_ID]: [{ ...structuredTab(FIRST_TAB_ID, 'session-1', 0), executionHostId }]
        },
        worktreesByRepo: {
          repo: [
            { id: WORKTREE_ID, repoId: 'repo', hostId: 'local' },
            { id: WORKTREE_ID, repoId: 'repo', hostId: 'runtime:cloud' }
          ]
        }
      })
      const view = render(
        <StructuredAgentSessionPaneOverlayLayer worktreeId={WORKTREE_ID} isWorktreeActive={false} />
      )
      if (executionHostId === 'ssh:alpha') {
        expect(view.baseElement.querySelector('[data-chat-tab-id]')).toBeNull()
      } else {
        expect(chatSurface(view.baseElement, FIRST_TAB_ID).dataset.chatTarget).toBe('cloud')
      }
    }
  )

  it('rejects conflicting bucket and tab ownership', () => {
    const bucket = `local|${WORKTREE_ID}`
    mocks.store?.setState({
      activeView: 'sessions',
      sessionsView: { selectedSessionKey: `${bucket}|${FIRST_TAB_ID}` },
      unifiedTabsByWorktree: {
        [bucket]: [
          { ...structuredTab(FIRST_TAB_ID, 'session-1', 0), executionHostId: 'runtime:cloud' }
        ]
      }
    })
    const view = render(
      <StructuredAgentSessionPaneOverlayLayer worktreeId={bucket} isWorktreeActive={false} />
    )
    expect(view.baseElement.querySelector('[data-chat-tab-id]')).toBeNull()
  })
})

function createState(activeTabId: string): MockAppState {
  return {
    activeView: 'terminal',
    sessionsView: { selectedSessionKey: null },
    unifiedTabsByWorktree: {
      [WORKTREE_ID]: [
        structuredTab(FIRST_TAB_ID, 'session-1', 0),
        structuredTab(SECOND_TAB_ID, 'session-2', 1)
      ]
    },
    groupsByWorktree: { [WORKTREE_ID]: [createGroup(activeTabId)] },
    activeGroupIdByWorktree: { [WORKTREE_ID]: GROUP_ID },
    runtimeEnvironmentId: null,
    repos: [],
    folderWorkspaces: [],
    projectGroups: [],
    worktreesByRepo: { repo: [{ id: WORKTREE_ID, repoId: 'repo', hostId: 'local' }] },
    focusGroup: mocks.focusGroup
  }
}

function createGroup(activeTabId: string): TabGroup {
  return {
    id: GROUP_ID,
    worktreeId: WORKTREE_ID,
    activeTabId,
    tabOrder: [FIRST_TAB_ID, SECOND_TAB_ID]
  }
}

function structuredTab(id: string, sessionId: string, sortOrder: number): Tab {
  return {
    id,
    entityId: sessionId,
    groupId: GROUP_ID,
    worktreeId: WORKTREE_ID,
    contentType: 'agent-session',
    agentSessionAgent: 'codex',
    label: 'Codex Chat',
    customLabel: null,
    color: null,
    sortOrder,
    createdAt: sortOrder + 1
  }
}

function chatSurface(container: HTMLElement, tabId: string): HTMLElement {
  const surface = container.querySelector<HTMLElement>(`[data-chat-tab-id="${tabId}"]`)
  if (!surface) {
    throw new Error(`missing structured chat surface ${tabId}`)
  }
  return surface
}
