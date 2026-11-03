// @vitest-environment happy-dom

import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { ProjectTreeContext } from './project-tree-context'
import {
  ProjectWorkspaceCardDisclosure,
  ProjectWorkspaceDisclosure
} from './ProjectWorkspaceDisclosure'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearWorktreeAgentExpansionStateForTests,
  getWorktreeAgentExpansionCountForTests,
  MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS,
  seedWorktreeAgentExpansionStateForTests,
  useWorktreeAgentExpansionState
} from './worktree-card-agents-expansion-state'

let mockAgents: DashboardAgentRow[] = []
let mockActiveWorktreeId: string | null = null
let mockActiveHostId: string | null = null

function mockAgent(paneKey: string, prompt: string): DashboardAgentRow {
  return {
    paneKey,
    tab: {
      id: paneKey.split(':')[0],
      ptyId: null,
      worktreeId: 'wt-remount',
      title: prompt,
      customTitle: null,
      color: null,
      sortOrder: 0,
      createdAt: 1000
    },
    agentType: 'codex',
    rowSource: undefined,
    state: 'done',
    startedAt: 1000,
    entry: {
      paneKey,
      updatedAt: 1000,
      prompt,
      lastAssistantMessage: undefined,
      state: 'done',
      stateStartedAt: 1000,
      stateHistory: [],
      orchestration: undefined
    },
    lineage: undefined
  }
}

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      activeView: 'terminal',
      activeWorktreeId: mockActiveWorktreeId,
      activeWorkspaceExecutionHostId: mockActiveHostId,
      agentActivityDisplayMode: 'compact',
      acknowledgedAgentsByPaneKey: {},
      retainedAgentsByPaneKey: {},
      cacheTimerByKey: {},
      dropAgentStatus: vi.fn(),
      dismissRetainedAgent: vi.fn(),
      agentSendPopoverTargetMode: null,
      agentStatusByPaneKey: {},
      agentStatusEpoch: 0,
      tabsByWorktree: {},
      terminalLayoutsByTabId: {},
      runtimePaneTitlesByTabId: {},
      sendPromptToSidebarAgentTarget: vi.fn(),
      settings: { promptCacheTimerEnabled: false, promptCacheTtlMs: 60_000 }
    })
}))

vi.mock('./useWorktreeAgentRows', () => ({
  useWorktreeAgentRows: vi.fn(() => mockAgents)
}))

vi.mock('@/hooks/use-now', () => ({
  useNow: vi.fn(() => 2000)
}))

vi.mock('./CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownForPane: () => null,
  usePromptCacheCountdownStartedAt: () => null
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: vi.fn()
}))

vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: vi.fn()
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

const mountedRoots: { root: Root; host: HTMLElement }[] = []

async function mountAgents(worktreeId: string): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push({ root, host })
  const { default: WorktreeCardAgents } = await import('./WorktreeCardAgents')
  await act(async () => {
    root.render(<WorktreeCardAgents worktreeId={worktreeId} />)
  })
  return host
}

function summaryButton(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button[aria-expanded]')
  if (!button) {
    throw new Error('compact agent summary button not found')
  }
  return button
}

describe('WorktreeCardAgents inline-list expansion durability', () => {
  beforeEach(() => {
    clearWorktreeAgentExpansionStateForTests()
    mockActiveWorktreeId = null
    mockActiveHostId = null
    mockAgents = [mockAgent('tab-1:1', 'One'), mockAgent('tab-2:2', 'Two')]
  })

  afterEach(async () => {
    await act(async () => {
      for (const { root, host } of mountedRoots.splice(0)) {
        root.unmount()
        host.remove()
      }
    })
    document.body.innerHTML = ''
    clearWorktreeAgentExpansionStateForTests()
  })

  it('shares the active project disclosure with session rows and keeps host twins independent', async () => {
    mockActiveWorktreeId = 'tree'
    mockActiveHostId = 'local'
    const { default: WorktreeCardAgents } = await import('./WorktreeCardAgents')
    const host = document.createElement('div')
    document.body.append(host)
    let root = createRoot(host)
    const tree = (
      <ProjectTreeContext.Provider value={true}>
        {(['local', 'ssh:other'] as const).map((hostId) => (
          <div key={hostId} data-host={hostId}>
            <ProjectWorkspaceCardDisclosure worktree={{ id: 'tree', hostId }} agents={mockAgents}>
              <ProjectWorkspaceDisclosure isFolder={false} />
              <WorktreeCardAgents worktreeId="tree" agents={mockAgents} />
            </ProjectWorkspaceCardDisclosure>
          </div>
        ))}
      </ProjectTreeContext.Provider>
    )
    await act(async () => root.render(tree))
    const local = () =>
      host.querySelector<HTMLButtonElement>('[data-host="local"] .project-tree-disclosure')!
    const remote = () =>
      host.querySelector<HTMLButtonElement>('[data-host="ssh:other"] .project-tree-disclosure')!
    expect(local().getAttribute('aria-expanded')).toBe('true')
    expect(remote().getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelectorAll('[data-host="local"] .project-tree-session-row')).toHaveLength(2)
    expect(host.querySelector('.compact-agent-summary-panel')).toBeNull()
    await act(async () => local().click())
    expect(local().getAttribute('aria-expanded')).toBe('false')
    expect(
      host
        .querySelector('[data-host="local"] .compact-agent-expansion-grid')
        ?.getAttribute('aria-hidden')
    ).toBe('true')
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => root.render(tree))
    expect(local().getAttribute('aria-expanded')).toBe('false')
    expect(remote().getAttribute('aria-expanded')).toBe('false')
    await act(async () => root.unmount())
    host.remove()
  })

  it('keeps the compact agent summary expanded across a card remount', async () => {
    const host = await mountAgents('wt-remount')
    expect(summaryButton(host).getAttribute('aria-expanded')).toBe('false')

    await act(async () => {
      summaryButton(host).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(summaryButton(host).getAttribute('aria-expanded')).toBe('true')

    // Fully remount the same worktree as virtualizer recycling or child-worktree toggles do.
    await act(async () => {
      const first = mountedRoots.shift()!
      first.root.unmount()
      first.host.remove()
    })
    const remounted = await mountAgents('wt-remount')

    expect(summaryButton(remounted).getAttribute('aria-expanded')).toBe('true')
  })

  it('does not leak expansion between different worktrees', async () => {
    const first = await mountAgents('wt-a')
    await act(async () => {
      summaryButton(first).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(summaryButton(first).getAttribute('aria-expanded')).toBe('true')

    const second = await mountAgents('wt-b')
    expect(summaryButton(second).getAttribute('aria-expanded')).toBe('false')
  })
})

describe('worktree-card-agents-expansion-state module cache', () => {
  beforeEach(() => {
    clearWorktreeAgentExpansionStateForTests()
  })

  afterEach(() => {
    clearWorktreeAgentExpansionStateForTests()
  })

  it('persists a collapsed lineage parent across a hook remount and toggles independently', async () => {
    function Probe({ worktreeId }: { worktreeId: string }) {
      const { collapsedLineageParents, toggleLineageParent } =
        useWorktreeAgentExpansionState(worktreeId)
      return (
        <button
          type="button"
          data-collapsed={collapsedLineageParents.has('pane-x') ? 'true' : 'false'}
          onClick={() => toggleLineageParent('pane-x')}
        >
          probe
        </button>
      )
    }

    const host = document.createElement('div')
    document.body.append(host)
    let root = createRoot(host)
    await act(async () => {
      root.render(<Probe worktreeId="wt-probe" />)
    })
    const read = () => host.querySelector('button')!.getAttribute('data-collapsed')
    expect(read()).toBe('false')

    await act(async () => {
      host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(read()).toBe('true')

    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => {
      root.render(<Probe worktreeId="wt-probe" />)
    })
    expect(read()).toBe('true')

    await act(async () => root.unmount())
    host.remove()
  })

  it('drops default (empty) state and bounds the cache with LRU eviction', () => {
    seedWorktreeAgentExpansionStateForTests('wt-default', {
      collapsedLineageParents: new Set(),
      compactRootListExpanded: false
    })
    expect(getWorktreeAgentExpansionCountForTests()).toBe(0)

    for (let i = 0; i < MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS + 25; i++) {
      seedWorktreeAgentExpansionStateForTests(`wt-${i}`, {
        collapsedLineageParents: new Set(),
        compactRootListExpanded: true
      })
    }
    expect(getWorktreeAgentExpansionCountForTests()).toBe(MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS)
  })

  it('preserves a manual collapse of the initially active session path after remount', async () => {
    mockActiveWorktreeId = 'active'
    mockActiveHostId = 'local'
    function Probe() {
      const { compactRootListExpanded, toggleCompactRootList } =
        useWorktreeAgentExpansionState('local|active')
      return (
        <button aria-expanded={compactRootListExpanded} onClick={toggleCompactRootList}>
          Toggle
        </button>
      )
    }
    const host = document.createElement('div')
    document.body.append(host)
    let root = createRoot(host)
    await act(async () => root.render(<Probe />))
    expect(host.querySelector('button')!.getAttribute('aria-expanded')).toBe('true')
    await act(async () => host.querySelector('button')!.click())
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => root.render(<Probe />))
    expect(host.querySelector('button')!.getAttribute('aria-expanded')).toBe('false')
    await act(async () => root.unmount())
    host.remove()
  })
})

it('toggles the visible state after the active-workspace default changes', async () => {
  clearWorktreeAgentExpansionStateForTests()
  function Probe({ active }: { active: boolean }) {
    mockActiveWorktreeId = active ? 'activation-change' : null
    mockActiveHostId = null
    const state = useWorktreeAgentExpansionState('activation-change')
    return (
      <button aria-expanded={state.compactRootListExpanded} onClick={state.toggleCompactRootList}>
        Toggle
      </button>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Probe active={false} />))
    await act(async () => root.render(<Probe active />))
    const button = host.querySelector('button')!
    const before = button.getAttribute('aria-expanded')
    expect(before).toBe('true')
    await act(async () => button.click())
    expect(button.getAttribute('aria-expanded')).not.toBe(before)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    clearWorktreeAgentExpansionStateForTests()
  }
})
