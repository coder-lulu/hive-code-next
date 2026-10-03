// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { TOGGLE_WORKSPACE_BOARD_EVENT, useWorkspaceBoardPanel } from './useWorkspaceBoardPanel'
import { toggleAgentDashboardFromShortcut } from '@/hooks/ipc-events/agent-dashboard-command'
import WorkspaceBoardDrawer from './WorkspaceBoardDrawer'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), reveal: vi.fn(), isWeb: vi.fn(() => false) }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: mocks.isWeb }))
vi.mock('../dashboard/useLiveDashboardSnapshot', () => ({
  useLiveDashboardSnapshot: mocks.snapshot
}))
vi.mock('../dashboard/reveal-dashboard-agent', () => ({ revealDashboardAgent: mocks.reveal }))
vi.mock('../dashboard/AgentDashboardSettingsMenu', () => ({
  AgentDashboardSettingsMenu: () => null
}))
vi.mock('./WorkspaceKanbanDrawer', () => ({
  default: ({
    searchState
  }: {
    searchState: { query: string; onQueryChange: (query: string) => void }
  }) => {
    return (
      <input
        aria-label="Search workspaces"
        value={searchState.query}
        onChange={(e) => searchState.onQueryChange(e.target.value)}
      />
    )
  }
}))
vi.mock('../dashboard-popout/AgentKanbanCard', () => ({
  AgentKanbanCard: ({
    card,
    onOpenTerminal
  }: {
    card: DashboardCard
    onOpenTerminal: (card: DashboardCard) => void
  }) => <button onClick={() => onOpenTerminal(card)}>{card.task}</button>
}))
vi.mock('../dashboard-popout/AgentTerminalDialog', () => ({
  AgentTerminalDialog: ({
    card,
    onReveal,
    onOpenChange
  }: {
    card: DashboardCard | null
    onReveal: (card: DashboardCard) => void
    onOpenChange: (open: boolean) => void
  }) =>
    card && (
      <section role="dialog" data-state="open">
        <button onClick={() => onReveal(card)}>Reveal terminal</button>
        <button onClick={() => onOpenChange(false)}>Close preview</button>
      </section>
    )
}))

function Probe(): React.JSX.Element {
  const panel = useWorkspaceBoardPanel()
  return (
    <WorkspaceBoardDrawer
      open={panel.workspaceBoardRenderedOpen}
      dragPreview={false}
      preserveOpenForMenu={panel.workspaceBoardMenuOpen}
      onMenuOpenChange={panel.setWorkspaceBoardMenuOpen}
      onOpenChange={panel.handleWorkspaceBoardOpenChange}
      statusBarVisible
    />
  )
}
const initial = useAppStore.getInitialState()
beforeEach(() => {
  mocks.isWeb.mockReturnValue(false)
  useAppStore.setState({
    workspaceBoardOpen: false,
    workspaceBoardView: 'workspaces',
    sidebarOpen: true
  })
  mocks.snapshot.mockReset().mockReturnValue({
    generatedAt: 1,
    cards: ['Alpha', 'Beta'].map((name, i) => ({
      paneKey: `tab-${i}:leaf-${i}`,
      ptyId: `pty-${i}`,
      tabId: `tab-${i}`,
      leafId: `leaf-${i}`,
      worktreeId: `worktree-${i}`,
      repoId: `repo-${i}`,
      repoName: name,
      worktreeName: name,
      task: `${name} task`,
      agentType: 'codex',
      bucket: 'working',
      dotState: 'working',
      startedAt: 0,
      finishedAt: null,
      stateChangedAt: 1,
      unseen: true
    }))
  })
  mocks.reveal.mockReset().mockReturnValue(true)
  Object.assign(window, {
    api: { dashboard: { openPopout: vi.fn().mockResolvedValue(undefined) } }
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  useAppStore.setState(initial, true)
})

describe('unified board views', () => {
  it('offers both views on the web without a desktop-window control', async () => {
    mocks.isWeb.mockReturnValue(true)
    useAppStore.setState({ workspaceBoardOpen: true, workspaceBoardView: 'agents' })
    render(<Probe />)
    expect(await screen.findByRole('button', { name: 'Beta task' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Workspaces' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open in separate window' })).toBeNull()
  })
  it('does no agent derivation while closed or on the workspace view', async () => {
    render(<Probe />)
    expect(mocks.snapshot).not.toHaveBeenCalled()
    act(() => useAppStore.getState().setWorkspaceBoardOpen(true))
    expect(await screen.findByRole('tab', { name: 'Workspaces' })).toBeTruthy()
    expect(mocks.snapshot).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Agents' }))
    expect(await screen.findByRole('button', { name: 'Beta task' })).toBeTruthy()
    expect(document.querySelectorAll('[data-workspace-board-sheet]')).toHaveLength(1)
  })

  it('retains independent workspace and agent queries when switching views', async () => {
    act(() => useAppStore.getState().setWorkspaceBoardOpen(true))
    render(<Probe />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search workspaces' }), {
      target: { value: 'Workspace query' }
    })
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Agents' }))
    const search = await screen.findByRole('textbox', { name: 'Search agents' })
    fireEvent.change(search, { target: { value: 'Beta' } })
    expect(screen.queryByRole('button', { name: 'Alpha task' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Beta task' })).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Workspaces' }))
    expect(
      (screen.getByRole('textbox', { name: 'Search workspaces' }) as HTMLInputElement).value
    ).toBe('Workspace query')
    const derivations = mocks.snapshot.mock.calls.length
    fireEvent.change(screen.getByRole('textbox', { name: 'Search workspaces' }), {
      target: { value: 'Other query' }
    })
    expect(mocks.snapshot).toHaveBeenCalledTimes(derivations)
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Agents' }))
    expect(
      ((await screen.findByRole('textbox', { name: 'Search agents' })) as HTMLInputElement).value
    ).toBe('Beta')
    expect(screen.queryByRole('button', { name: 'Alpha task' })).toBeNull()
  })

  it.each([
    {
      name: 'board shortcut',
      close: () => window.dispatchEvent(new CustomEvent(TOGGLE_WORKSPACE_BOARD_EVENT))
    },
    { name: 'Escape', close: () => fireEvent.keyDown(document.body, { key: 'Escape' }) }
  ])('resets workspace search on rapid reopen after $name', async ({ close }) => {
    useAppStore.setState({ workspaceBoardOpen: true })
    render(<Probe />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search workspaces' }), {
      target: { value: 'Workspace query' }
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(close)
    expect(useAppStore.getState().workspaceBoardOpen).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(299))
    act(() => window.dispatchEvent(new CustomEvent(TOGGLE_WORKSPACE_BOARD_EVENT)))
    expect(
      (screen.getByRole('textbox', { name: 'Search workspaces' }) as HTMLInputElement).value
    ).toBe('')
  })

  it('resets both searches and agent project filters on rapid reopen after the agent shortcut', async () => {
    useAppStore.setState({ workspaceBoardOpen: true })
    render(<Probe />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search workspaces' }), {
      target: { value: 'Workspace query' }
    })
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Agents' }))
    const search = await screen.findByRole('textbox', { name: 'Search agents' })
    fireEvent.change(search, { target: { value: 'Beta' } })
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Filter/ }), {
      button: 0,
      ctrlKey: false
    })
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Beta/ }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove Beta filter' })).toBeTruthy()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => toggleAgentDashboardFromShortcut(useAppStore.getState()))
    expect(useAppStore.getState().workspaceBoardOpen).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(299))
    await act(async () => toggleAgentDashboardFromShortcut(useAppStore.getState()))
    expect((screen.getByRole('textbox', { name: 'Search agents' }) as HTMLInputElement).value).toBe(
      ''
    )
    expect(screen.queryByRole('button', { name: 'Remove Beta filter' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Alpha task' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Beta task' })).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Workspaces' }))
    expect(
      (screen.getByRole('textbox', { name: 'Search workspaces' }) as HTMLInputElement).value
    ).toBe('')
  })

  it('keeps the board open during terminal preview and separate-window opening', async () => {
    useAppStore.setState({ workspaceBoardOpen: true, workspaceBoardView: 'agents' })
    const ack = vi.spyOn(useAppStore.getState(), 'acknowledgeAgents').mockImplementation(() => {})
    render(<Probe />)
    fireEvent.click(await screen.findByRole('button', { name: 'Alpha task' }))
    expect(ack).toHaveBeenCalledWith(['tab-0:leaf-0'])
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useAppStore.getState().workspaceBoardOpen).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open in separate window' }))
    expect(window.api.dashboard.openPopout).toHaveBeenCalledOnce()
    expect(useAppStore.getState().workspaceBoardOpen).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Beta task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal terminal' }))
    expect(mocks.reveal).toHaveBeenCalledWith(expect.objectContaining({ worktreeId: 'worktree-1' }))
    expect(useAppStore.getState().workspaceBoardOpen).toBe(false)
    ack.mockRestore()
  })

  it('clears agent search before Escape closes the board', async () => {
    useAppStore.setState({ workspaceBoardOpen: true, workspaceBoardView: 'agents' })
    render(<Probe />)
    const input = await screen.findByRole('textbox', { name: 'Search agents' })
    fireEvent.change(input, { target: { value: 'Beta' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useAppStore.getState().workspaceBoardOpen).toBe(true)
    expect((input as HTMLInputElement).value).toBe('')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useAppStore.getState().workspaceBoardOpen).toBe(false)
  })
})
