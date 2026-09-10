// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { SidebarSettingsHelpMenu } from './SidebarSettingsHelpMenu'

const mocks = vi.hoisted(() => ({
  openModal: vi.fn(),
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn(),
  shellOpenUrl: vi.fn(),
  useShortcutKeyDetails: vi.fn(),
  useSetupGuideProgress: vi.fn(),
  useSetupGuideProgressSnapshot: vi.fn(),
  /** Counts evaluations of the feedback chunk; a dynamic import evaluates it exactly once. */
  feedbackChunkLoads: 0,
  setupProgress: {
    ready: true,
    coreDoneCount: 2,
    coreTotal: 5,
    stepDone: {}
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      openModal: mocks.openModal,
      openSettingsPage: mocks.openSettingsPage,
      openSettingsTarget: mocks.openSettingsTarget
    })
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutKeyDetails: mocks.useShortcutKeyDetails,
  useShortcutKeyComboDetails: () => [{ keys: ['Ctrl', 'J'], doubleTap: false }]
}))

vi.mock('../onboarding/show-onboarding-event', () => ({
  showOnboardingFromRenderer: vi.fn()
}))

vi.mock('../setup-guide/use-setup-guide-progress', () => ({
  useSetupGuideProgress: mocks.useSetupGuideProgress
}))

vi.mock('../setup-guide/setup-guide-progress-snapshot', () => ({
  useSetupGuideProgressSnapshot: mocks.useSetupGuideProgressSnapshot
}))

vi.mock('../setup-guide/SetupGuideProgressRing', () => ({
  SetupGuideProgressRing: () => <span data-testid="setup-guide-progress-ring" />
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({
    children,
    onOpenChange
  }: {
    children: ReactNode
    onOpenChange?: (open: boolean) => void
  }) => (
    <>
      <button data-testid="open-menu" onClick={() => onOpenChange?.(true)} />
      {children}
    </>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({
    children,
    disabled,
    onPointerDown,
    onSelect,
    title
  }: {
    children: ReactNode
    disabled?: boolean
    onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void
    onSelect?: (event: Event) => void
    title?: string
  }) => (
    <button
      data-testid="menu-item"
      disabled={disabled}
      onClick={() => onSelect?.(new Event('menu.itemSelect'))}
      onPointerDown={onPointerDown}
      title={title}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel
  }: {
    children: ReactNode
    onClick?: (event: React.MouseEvent) => void
    'aria-label'?: string
  }) => (
    <button data-testid="trigger-button" aria-label={ariaLabel} onClick={onClick}>
      {children}
    </button>
  )
}))

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('./SidebarFeedbackDialog', () => {
  mocks.feedbackChunkLoads += 1
  return { SidebarFeedbackDialog: () => <div data-testid="feedback-dialog" /> }
})

function installWindowApi(): void {
  Object.assign(window, {
    api: {
      shell: {
        openUrl: mocks.shellOpenUrl
      }
    }
  })
}

let mountedRoot: Root | undefined
let mountedContainer: HTMLDivElement | undefined

async function renderMenu(): Promise<HTMLDivElement> {
  mountedContainer = document.createElement('div')
  document.body.append(mountedContainer)
  mountedRoot = createRoot(mountedContainer)
  await act(async () => mountedRoot?.render(<SidebarSettingsHelpMenu />))
  return mountedContainer
}

afterEach(() => {
  act(() => mountedRoot?.unmount())
  mountedContainer?.remove()
  mountedRoot = undefined
  mountedContainer = undefined
})

describe('SidebarSettingsHelpMenu', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    installWindowApi()
    mocks.useShortcutKeyDetails.mockReturnValue({ keys: ['⌘', ','], doubleTap: false })
    mocks.setupProgress = {
      ready: true,
      coreDoneCount: 2,
      coreTotal: 5,
      stepDone: {}
    }
    mocks.useSetupGuideProgress.mockImplementation(() => mocks.setupProgress)
    mocks.useSetupGuideProgressSnapshot.mockImplementation(() => mocks.setupProgress)
  })

  it('opens the existing search palette from the button immediately before settings', async () => {
    const container = await renderMenu()
    const search = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Search worktrees and browser tabs"]'
    )
    const settings = container.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')
    expect(search).not.toBeNull()
    expect(search?.parentElement).toBe(settings?.parentElement)
    expect(
      search!.compareDocumentPosition(settings!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    await act(async () => search!.click())
    expect(mocks.openModal).toHaveBeenCalledWith('worktree-palette')
  })

  it('renders the help button with correct aria-label', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Help')
  })

  it('renders the settings button with correct aria-label', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('aria-label="Settings"')
  })

  it('renders the settings button before the help button', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    const settingsIndex = html.indexOf('lucide-settings')
    const helpIndex = html.indexOf('lucide-circle-question-mark')
    expect(settingsIndex).toBeGreaterThanOrEqual(0)
    expect(helpIndex).toBeGreaterThan(settingsIndex)
  })

  it('renders Send Feedback menu item', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Send Feedback')
  })

  it('renders Keyboard Shortcuts menu item', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Keyboard Shortcuts')
  })

  it('renders Milestones with progress when setup is incomplete', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Milestones')
    expect(html).toContain('data-testid="setup-guide-progress-ring"')
  })

  it('reads the root observer snapshot without starting another progress probe', () => {
    renderToStaticMarkup(<SidebarSettingsHelpMenu />)

    expect(mocks.useSetupGuideProgressSnapshot).toHaveBeenCalledOnce()
    expect(mocks.useSetupGuideProgress).not.toHaveBeenCalled()
  })

  it('hides Milestones when setup is complete', () => {
    mocks.setupProgress = {
      ready: true,
      coreDoneCount: 5,
      coreTotal: 5,
      stepDone: {}
    }
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).not.toContain('Milestones')
  })

  it('renders the Onboarding menu item by default', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Onboarding')
  })

  it('hides public help links when no official product authorities are configured', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    for (const label of ['Docs', 'Changelog', 'GitHub', 'Discord', '>X<']) {
      expect(html).not.toContain(label)
    }
    expect(mocks.shellOpenUrl).not.toHaveBeenCalled()
  })

  it('keeps update and restart actions out of the help menu', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).not.toContain('Check for Updates')
    expect(html).not.toContain(`Restart ${APP_DISPLAY_NAME}`)
  })

  // No other test in this file opens the menu or selects Send Feedback, so the 0 -> 1
  // transition below is this warm and nothing else, whatever order the tests run in.
  it('warms the feedback chunk when the menu opens, before Send Feedback is selected', async () => {
    const container = await renderMenu()
    expect(mocks.feedbackChunkLoads).toBe(0)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="open-menu"]')?.click()
    })

    expect(mocks.feedbackChunkLoads).toBe(1)
    // Warming must not mount the dialog: it stays behind its own open state.
    expect(document.body.querySelector('[data-testid="feedback-dialog"]')).toBeNull()
  })

  it('renders shortcut keys in the settings tooltip', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('⌘')
    expect(html).toContain('>,</span>')
  })
})
