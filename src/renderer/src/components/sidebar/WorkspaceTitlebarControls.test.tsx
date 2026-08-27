// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceBoardPanelState } from './useWorkspaceBoardPanel'
import { WorkspaceTitlebarControls } from './WorkspaceTitlebarControls'

const mocks = vi.hoisted(() => ({
  activeTooltipOpen: false,
  state: {
    persistedUIReady: true,
    featureInteractions: {}
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children, open }: { children: ReactNode; open?: boolean }) => {
    mocks.activeTooltipOpen = open === true
    return <>{children}</>
  },
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) =>
    mocks.activeTooltipOpen ? <span>{children}</span> : null
}))

vi.mock('./ScrollToCurrentWorkspaceToolbarButton', () => ({
  ScrollToCurrentWorkspaceToolbarButton: () => <button type="button">Current workspace</button>
}))

const roots: Root[] = []

function createPanel(toggleWorkspaceBoard = vi.fn()): WorkspaceBoardPanelState {
  return {
    workspaceBoardOpen: false,
    workspaceBoardRenderedOpen: false,
    workspaceBoardDragPreviewOpen: false,
    workspaceBoardMenuOpen: false,
    openWorkspaceBoard: vi.fn(),
    closeWorkspaceBoard: vi.fn(),
    toggleWorkspaceBoard,
    handleWorkspaceBoardOpenChange: vi.fn(),
    setWorkspaceBoardMenuOpen: vi.fn(),
    previewWorkspaceBoardFromDrag: vi.fn(),
    solidifyWorkspaceBoardFromDrag: vi.fn(),
    cancelWorkspaceBoardDragPreview: vi.fn()
  }
}

async function renderControls(panel = createPanel()): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(<WorkspaceTitlebarControls workspaceBoardPanel={panel} />))
  return container
}

describe('WorkspaceTitlebarControls', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    mocks.activeTooltipOpen = false
    mocks.state = { persistedUIReady: true, featureInteractions: {} }
  })

  afterEach(() => {
    roots.splice(0).forEach((root) => act(() => root.unmount()))
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  it('keeps the reveal and workspace board actions in the titlebar cluster', async () => {
    const panel = createPanel()
    const container = await renderControls(panel)

    expect(container.textContent).toContain('Current workspace')
    const boardButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Workspace board"]'
    )
    expect(boardButton).not.toBeNull()

    await act(async () => boardButton?.click())
    expect(panel.toggleWorkspaceBoard).toHaveBeenCalledOnce()
  })

  it('shows the top-bar relocation hint once to existing board users', async () => {
    mocks.state = {
      persistedUIReady: true,
      featureInteractions: {
        'workspace-board': { firstInteractedAt: 100, interactionCount: 2 }
      }
    }

    const container = await renderControls()

    expect(container.textContent).toContain('Workspace board moved to the top bar')
    expect(window.localStorage.getItem('orca.workspaceBoardMovedHintSeen.v2')).toBe('true')
  })
})
