// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { toggleAgentDashboardFromShortcut } from '@/hooks/ipc-events/agent-dashboard-command'
import {
  TOGGLE_WORKSPACE_BOARD_EVENT,
  useWorkspaceBoardPanel,
  type WorkspaceBoardPanelState
} from './useWorkspaceBoardPanel'

const mocks = vi.hoisted(() => ({
  recordFeatureInteraction: vi.fn()
}))

vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  return {
    useAppStore: create<{
      workspaceBoardOpen: boolean
      workspaceBoardView: 'workspaces' | 'agents'
      setWorkspaceBoardOpen: (open: boolean) => void
      setWorkspaceBoardView: (view: 'workspaces' | 'agents') => void
      setSidebarOpen: (open: boolean) => void
      recordFeatureInteraction: typeof mocks.recordFeatureInteraction
    }>((set) => ({
      workspaceBoardOpen: false,
      workspaceBoardView: 'workspaces',
      setWorkspaceBoardOpen: (open) => set({ workspaceBoardOpen: open }),
      setWorkspaceBoardView: (view) => set({ workspaceBoardView: view }),
      setSidebarOpen: vi.fn(),
      recordFeatureInteraction: mocks.recordFeatureInteraction
    }))
  }
})

let latestState: WorkspaceBoardPanelState | null = null
const roots: Root[] = []

function HookProbe(): null {
  latestState = useWorkspaceBoardPanel()
  return null
}

async function renderHookProbe(): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<HookProbe />)
  })
}

function panelState(): WorkspaceBoardPanelState {
  if (!latestState) {
    throw new Error('Hook state has not been rendered')
  }
  return latestState
}

async function updatePanel(update: (state: WorkspaceBoardPanelState) => void): Promise<void> {
  await act(async () => {
    update(panelState())
  })
}

async function pressEscape(from: EventTarget = document): Promise<void> {
  await act(async () => {
    from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

function appendInput(inside: 'board' | 'app'): HTMLInputElement {
  const host = document.createElement('div')
  if (inside === 'board') {
    host.setAttribute('data-workspace-board-sheet', '')
  }
  const field = document.createElement('input')
  host.appendChild(field)
  document.body.appendChild(host)
  return field
}

describe('useWorkspaceBoardPanel', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    latestState = null
    useAppStore.setState({ workspaceBoardOpen: false, workspaceBoardView: 'workspaces' })
    mocks.recordFeatureInteraction.mockReset()
  })

  afterEach(() => {
    roots.splice(0).forEach((root) => {
      act(() => root.unmount())
    })
    document.body.replaceChildren()
  })

  it('toggles the board and records the feature interaction when opened', async () => {
    await renderHookProbe()

    await updatePanel((state) => state.toggleWorkspaceBoard())

    expect(panelState().workspaceBoardOpen).toBe(true)
    expect(panelState().workspaceBoardRenderedOpen).toBe(true)
    expect(panelState().workspaceBoardDragPreviewOpen).toBe(false)
    expect(mocks.recordFeatureInteraction).toHaveBeenCalledExactlyOnceWith('workspace-board')

    await updatePanel((state) => state.toggleWorkspaceBoard())

    expect(panelState().workspaceBoardOpen).toBe(false)
    expect(panelState().workspaceBoardRenderedOpen).toBe(false)
    expect(mocks.recordFeatureInteraction).toHaveBeenCalledOnce()
  })

  it('toggles the board from the shortcut bridge event', async () => {
    await renderHookProbe()

    await act(async () => {
      window.dispatchEvent(new CustomEvent(TOGGLE_WORKSPACE_BOARD_EVENT))
    })

    expect(panelState().workspaceBoardOpen).toBe(true)
    expect(panelState().workspaceBoardRenderedOpen).toBe(true)
    expect(mocks.recordFeatureInteraction).toHaveBeenCalledExactlyOnceWith('workspace-board')

    await act(async () => {
      window.dispatchEvent(new CustomEvent(TOGGLE_WORKSPACE_BOARD_EVENT))
    })

    expect(panelState().workspaceBoardOpen).toBe(false)
    expect(panelState().workspaceBoardRenderedOpen).toBe(false)
    expect(mocks.recordFeatureInteraction).toHaveBeenCalledOnce()
  })

  it('renders a drag preview without recording an open interaction', async () => {
    await renderHookProbe()

    await updatePanel((state) => state.previewWorkspaceBoardFromDrag())

    expect(panelState().workspaceBoardOpen).toBe(false)
    expect(panelState().workspaceBoardRenderedOpen).toBe(true)
    expect(panelState().workspaceBoardDragPreviewOpen).toBe(true)
    expect(mocks.recordFeatureInteraction).not.toHaveBeenCalled()
  })

  it('cancels an uncommitted drag preview', async () => {
    await renderHookProbe()

    await updatePanel((state) => state.previewWorkspaceBoardFromDrag())
    await updatePanel((state) => state.cancelWorkspaceBoardDragPreview())

    expect(panelState().workspaceBoardOpen).toBe(false)
    expect(panelState().workspaceBoardRenderedOpen).toBe(false)
    expect(panelState().workspaceBoardDragPreviewOpen).toBe(false)
  })

  it('solidifies a drag preview and keeps the board open after drag cleanup', async () => {
    await renderHookProbe()

    await updatePanel((state) => state.previewWorkspaceBoardFromDrag())
    await updatePanel((state) => state.solidifyWorkspaceBoardFromDrag())
    await updatePanel((state) => state.cancelWorkspaceBoardDragPreview())

    expect(panelState().workspaceBoardOpen).toBe(true)
    expect(panelState().workspaceBoardRenderedOpen).toBe(true)
    expect(panelState().workspaceBoardDragPreviewOpen).toBe(false)
    expect(mocks.recordFeatureInteraction).toHaveBeenCalledExactlyOnceWith('workspace-board')
  })

  it('keeps the board open on Escape while a nested board menu is open', async () => {
    await renderHookProbe()

    await updatePanel((state) => state.openWorkspaceBoard())
    await updatePanel((state) => state.setWorkspaceBoardMenuOpen(true))
    await pressEscape()

    expect(panelState().workspaceBoardOpen).toBe(true)

    await updatePanel((state) => state.setWorkspaceBoardMenuOpen(false))
    await pressEscape()

    expect(panelState().workspaceBoardOpen).toBe(false)
  })

  it('clears an unmounted menu guard after the agent shortcut closes the board', async () => {
    await renderHookProbe()
    await act(async () => useAppStore.getState().setWorkspaceBoardView('agents'))
    await updatePanel((state) => state.openWorkspaceBoard())
    await updatePanel((state) => state.setWorkspaceBoardMenuOpen(true))

    await act(async () => {
      toggleAgentDashboardFromShortcut({ ...useAppStore.getState(), activeView: 'terminal' })
    })
    expect(panelState().workspaceBoardOpen).toBe(false)
    expect(panelState().workspaceBoardMenuOpen).toBe(false)

    await act(async () => {
      toggleAgentDashboardFromShortcut({ ...useAppStore.getState(), activeView: 'terminal' })
    })
    await pressEscape()
    expect(panelState().workspaceBoardOpen).toBe(false)
  })

  it('clears an unmounted workspace menu guard when the shortcut switches to agents', async () => {
    await renderHookProbe()
    await updatePanel((state) => state.openWorkspaceBoard())
    await updatePanel((state) => state.setWorkspaceBoardMenuOpen(true))

    await act(async () => {
      toggleAgentDashboardFromShortcut({ ...useAppStore.getState(), activeView: 'terminal' })
    })
    expect(useAppStore.getState().workspaceBoardView).toBe('agents')
    expect(panelState().workspaceBoardOpen).toBe(true)
    expect(panelState().workspaceBoardMenuOpen).toBe(false)

    await pressEscape()
    expect(panelState().workspaceBoardOpen).toBe(false)
  })

  it('lets Escape close the board while non-interactive tooltip content is open', async () => {
    await renderHookProbe()
    const tooltip = document.createElement('div')
    tooltip.setAttribute('data-slot', 'tooltip-content')
    tooltip.setAttribute('data-state', 'open')
    document.body.appendChild(tooltip)

    await updatePanel((state) => state.openWorkspaceBoard())
    await pressEscape()

    expect(panelState().workspaceBoardOpen).toBe(false)
  })

  it('lets Escape close the board when the board sheet itself is the open dialog', async () => {
    await renderHookProbe()
    const boardSheet = document.createElement('div')
    boardSheet.setAttribute('role', 'dialog')
    boardSheet.setAttribute('data-state', 'open')
    boardSheet.setAttribute('data-workspace-board-sheet', '')
    document.body.appendChild(boardSheet)

    await updatePanel((state) => state.openWorkspaceBoard())
    await pressEscape()

    expect(panelState().workspaceBoardOpen).toBe(false)
  })

  it('keeps the board open on Escape while an interactive popover is open', async () => {
    await renderHookProbe()
    const popover = document.createElement('div')
    popover.setAttribute('data-slot', 'popover-content')
    popover.setAttribute('data-state', 'open')
    document.body.appendChild(popover)

    await updatePanel((state) => state.openWorkspaceBoard())
    await pressEscape()

    expect(panelState().workspaceBoardOpen).toBe(true)
  })

  it('defers Escape to a text field inside the board', async () => {
    // Why: this listener is capture-phase on document, so it runs before React's
    // handlers and a board field cannot stopPropagation its way out. The field
    // owns Escape and calls closeWorkspaceBoard itself when it has nothing to
    // cancel — without this guard, clearing a search query dismissed the board.
    await renderHookProbe()
    const field = appendInput('board')

    await updatePanel((state) => state.openWorkspaceBoard())
    await pressEscape(field)

    expect(panelState().workspaceBoardOpen).toBe(true)
  })

  it('still closes the board on Escape from a text field outside it', async () => {
    await renderHookProbe()
    const field = appendInput('app')

    await updatePanel((state) => state.openWorkspaceBoard())
    await pressEscape(field)

    expect(panelState().workspaceBoardOpen).toBe(false)
  })

  it('keeps the board open on Escape while a nested dialog is open', async () => {
    await renderHookProbe()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('data-state', 'open')
    document.body.appendChild(dialog)

    await updatePanel((state) => state.openWorkspaceBoard())
    await pressEscape()

    expect(panelState().workspaceBoardOpen).toBe(true)
  })
})
