// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceBoardPanelState } from './useWorkspaceBoardPanel'
import { WorkspaceBoardButton } from './WorkspaceBoardButton'

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
  TooltipContent: ({ children, className }: { children: ReactNode; className?: string }) =>
    mocks.activeTooltipOpen ? (
      <span data-testid="workspace-board-tooltip" className={className}>
        {children}
      </span>
    ) : null
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
  await act(async () => root.render(<WorkspaceBoardButton workspaceBoardPanel={panel} />))
  return container
}

describe('WorkspaceBoardButton', () => {
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

  it('toggles the existing workspace board', async () => {
    const panel = createPanel()
    const container = await renderControls(panel)

    expect(container.textContent).not.toContain('Current workspace')
    const boardButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Workspace board"]'
    )
    expect(boardButton).not.toBeNull()

    await act(async () => boardButton?.click())
    expect(panel.toggleWorkspaceBoard).toHaveBeenCalledOnce()
  })

  it('reflects the open state and drag preview', async () => {
    const panel = createPanel()
    panel.workspaceBoardOpen = true
    panel.workspaceBoardDragPreviewOpen = true
    const container = await renderControls(panel)
    const button = container.querySelector('[data-workspace-board-trigger]')
    expect(button?.getAttribute('aria-pressed')).toBe('true')
    expect(button?.getAttribute('data-workspace-board-preview')).toBe('true')
  })
})
