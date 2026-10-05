// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { HiveAccountState } from '../../../../shared/hive-account'
import type { Repo } from '../../../../shared/repo-types'
import { i18n } from '../../i18n/i18n'
import { PSEUDO_LOCALIZATION_LOCALE } from '../../i18n/pseudo-localization'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  onNavigate: vi.fn(),
  accountStateChanged: null as ((state: HiveAccountState) => void) | null,
  openDeviceConnectionsPage: vi.fn(),
  openNewTaskHome: vi.fn(),
  openSessionsPage: vi.fn(),
  updateSessionsView: vi.fn(),
  openTaskPage: vi.fn(),
  openAutomationsPage: vi.fn(),
  openActivityPage: vi.fn(),
  openArtifactsPage: vi.fn(),
  openSkillsPage: vi.fn(),
  openModal: vi.fn(),
  updateSettings: vi.fn(),
  refreshPreflightStatus: vi.fn(),
  checkLinearConnection: vi.fn(),
  agentBucketCounts: { attention: 0, working: 0, done: 0, idle: 0 },
  getAgentBucketCounts: vi.fn(),
  setSetupGuideSidebarDismissed: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

vi.mock('@/store/selectors', () => ({
  useRepoMap: () =>
    new Map(
      ((mocks.state.repos as Repo[] | undefined) ?? []).map((repo) => [repo.id, repo] as const)
    )
}))

vi.mock('@/components/activity/useActivityUnreadCount', () => ({
  useActivityUnreadCount: () => 0
}))

vi.mock('../mobile/paired-mobile-devices', () => ({
  usePairedMobileDevices: () => ({ loaded: true, error: null, hasPairedDevice: false })
}))

vi.mock('@/components/dashboard/useAgentBucketCounts', () => ({
  useAgentBucketCounts: () => {
    mocks.getAgentBucketCounts()
    return mocks.agentBucketCounts
  }
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutKeyComboDetails: () => [{ keys: ['⌘', 'J'], doubleTap: false }],
  useShortcutLabel: () => '⌘N'
}))

vi.mock('../setup-guide/use-setup-guide-progress', () => ({
  useSetupGuideProgress: () => ({
    ready: true,
    coreDoneCount: 0,
    coreTotal: 1,
    stepDone: {}
  })
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => (
    <div data-testid="context-menu">{children}</div>
  ),
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="context-menu-content">{children}</div>
  ),
  ContextMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  )
}))

import SidebarNav, { shouldShowAutomationsButton, shouldShowArtifactsButton } from './SidebarNav'

function gitRepo(): Repo {
  return {
    id: 'repo-1',
    path: '/tmp/repo-1',
    displayName: 'repo-1',
    badgeColor: 'gray',
    addedAt: 1,
    kind: 'git'
  }
}

function folderRepo(): Repo {
  return {
    id: 'folder-1',
    path: '/tmp/folder-1',
    displayName: 'folder-1',
    badgeColor: 'gray',
    addedAt: 1,
    kind: 'folder'
  }
}

function setSidebarState({
  settings = getDefaultSettings('/tmp'),
  repos = [gitRepo()],
  activeView = 'worktrees',
  homeNewTaskMode = false,
  activeWorkspaceKey = null
}: {
  settings?: GlobalSettings
  repos?: Repo[]
  activeView?: string
  homeNewTaskMode?: boolean
  activeWorkspaceKey?: string | null
} = {}): void {
  mocks.state = {
    settings,
    repos,
    activeView,
    homeNewTaskMode,
    activeWorkspaceKey,
    openNewTaskHome: mocks.openNewTaskHome,
    openSessionsPage: mocks.openSessionsPage,
    updateSessionsView: mocks.updateSessionsView,
    sessionsView: { scope: { kind: 'all' }, navigation: 'sessions' },
    openTaskPage: mocks.openTaskPage,
    openAutomationsPage: mocks.openAutomationsPage,
    openActivityPage: mocks.openActivityPage,
    openArtifactsPage: mocks.openArtifactsPage,
    openSkillsPage: mocks.openSkillsPage,
    openDeviceConnectionsPage: mocks.openDeviceConnectionsPage,
    openModal: mocks.openModal,
    updateSettings: mocks.updateSettings,
    preflightStatus: { glab: { installed: false } },
    preflightStatusChecked: true,
    refreshPreflightStatus: mocks.refreshPreflightStatus,
    linearStatus: { connected: false },
    linearStatusChecked: true,
    checkLinearConnection: mocks.checkLinearConnection,
    prefetchWorkItems: vi.fn(),
    activeRepoId: null,
    persistedUIReady: true,
    activeModal: null,
    setupGuideSidebarDismissed: true,
    setSetupGuideSidebarDismissed: mocks.setSetupGuideSidebarDismissed
  }
}

const mountedRoots: Root[] = []

async function renderSidebarNav(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <SidebarNav onNavigate={mocks.onNavigate} />
      </TooltipProvider>
    )
  })
  return container
}

function queryButtonByText(container: ParentNode, text: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === text
    ) ?? null
  )
}

function getButtonByText(container: ParentNode, text: string): HTMLButtonElement {
  const button = queryButtonByText(container, text)
  if (!button) {
    throw new Error(`Button not found: ${text}`)
  }
  return button
}

function getHideButton(menu: Element): HTMLButtonElement {
  const button =
    Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
      candidate.textContent?.includes('Hide from sidebar')
    ) ?? null
  if (!button) {
    throw new Error('Hide from sidebar button not found')
  }
  return button
}

async function clickButton(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('SidebarNav', () => {
  afterEach(async () => {
    await act(async () => {
      for (const root of mountedRoots.splice(0)) {
        root.unmount()
      }
    })
    document.body.innerHTML = ''
  })

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    mocks.accountStateChanged = null
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        hiveAccount: {
          getState: vi
            .fn()
            .mockResolvedValue({ configured: true, status: 'signed-out', persistence: 'none' }),
          onStateChanged: (listener: (state: HiveAccountState) => void) => {
            mocks.accountStateChanged = listener
            return vi.fn()
          }
        }
      }
    })
    await i18n.changeLanguage('en')
    mocks.agentBucketCounts = { attention: 0, working: 0, done: 0, idle: 0 }
    setSidebarState()
  })

  it('places Sessions and Projects immediately after New task and returns to remembered session scope', async () => {
    setSidebarState({ activeView: 'sessions' })
    const container = await renderSidebarNav()
    const buttons = Array.from(container.querySelectorAll('button'))
    const sessions = getButtonByText(container, 'Sessions')
    const projects = getButtonByText(container, 'Projects')
    const newTask = container.querySelector('button[aria-label="New task"]')
    expect(buttons.indexOf(sessions)).toBe(buttons.indexOf(newTask as HTMLButtonElement) + 1)
    expect(buttons.indexOf(projects)).toBe(buttons.indexOf(sessions) + 1)
    expect(sessions.getAttribute('aria-current')).toBe('page')
    await clickButton(sessions)
    expect(mocks.openSessionsPage).toHaveBeenCalledWith()
    await clickButton(projects)
    expect(mocks.updateSessionsView).toHaveBeenCalledWith({ navigation: 'projects', query: '' })
  })

  it('keeps the Agent Dashboard row unmounted while its experiment is off', async () => {
    const container = await renderSidebarNav()

    expect(queryButtonByText(container, 'Agent Dashboard')).toBeNull()
    expect(mocks.getAgentBucketCounts).not.toHaveBeenCalled()
  })

  it.each(['Sessions', 'Projects', 'Tasks', 'Automations', 'Phone connection'] as const)(
    'dismisses the companion board before opening %s',
    async (label) => {
      setSidebarState({ activeView: 'sessions' })
      mocks.state.sessionsView = { scope: { kind: 'all' }, navigation: 'projects' }
      const container = await renderSidebarNav()
      const navigationAction = {
        Sessions: mocks.openSessionsPage,
        Projects: mocks.openSessionsPage,
        Tasks: mocks.openTaskPage,
        Automations: mocks.openAutomationsPage,
        'Phone connection': mocks.openDeviceConnectionsPage
      }[label]

      const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) => candidate.textContent?.trim().startsWith(label)
      )!
      await clickButton(button)

      expect(mocks.onNavigate).toHaveBeenCalledOnce()
      expect(navigationAction).toHaveBeenCalledOnce()
      expect(mocks.onNavigate.mock.invocationCallOrder[0]).toBeLessThan(
        navigationAction.mock.invocationCallOrder[0]
      )
    }
  )

  it('uses the board entry instead of a separate Agent Dashboard row', async () => {
    const container = await renderSidebarNav()
    expect(queryButtonByText(container, 'Agent Dashboard')).toBeNull()
    expect(mocks.getAgentBucketCounts).not.toHaveBeenCalled()
  })

  it('hides the Artifacts entry by default for older settings', () => {
    expect(shouldShowArtifactsButton(null)).toBe(false)
    expect(shouldShowArtifactsButton({})).toBe(false)
    expect(shouldShowArtifactsButton({ showArtifactsButton: true })).toBe(true)
    expect(shouldShowArtifactsButton({ showArtifactsButton: false })).toBe(false)
  })

  it('opens Artifacts from the sidebar', async () => {
    setSidebarState({
      settings: { ...getDefaultSettings('/tmp'), showArtifactsButton: true }
    })
    const container = await renderSidebarNav()

    await clickButton(getButtonByText(container, 'Artifacts'))

    expect(mocks.openArtifactsPage).toHaveBeenCalledOnce()
  })

  it('does not keep New task selected after another top-level page becomes active', async () => {
    setSidebarState({ activeView: 'tasks', homeNewTaskMode: true })
    const container = await renderSidebarNav()

    const newTaskButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New task"]'
    )
    const tasksButton = getButtonByText(container, 'Tasks')

    expect(newTaskButton?.className).not.toContain('is-active')
    expect(newTaskButton?.getAttribute('aria-current')).toBeNull()
    expect(tasksButton.getAttribute('aria-current')).toBe('page')
  })

  it('selects New task while its home surface is the active top-level view', async () => {
    setSidebarState({ activeView: 'terminal', homeNewTaskMode: true })
    const container = await renderSidebarNav()

    const newTaskButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New task"]'
    )

    expect(newTaskButton?.className).toContain('is-active')
    expect(newTaskButton?.getAttribute('aria-current')).toBe('page')
  })

  it('does not select New task when a workspace is active', async () => {
    setSidebarState({
      activeView: 'terminal',
      homeNewTaskMode: true,
      activeWorkspaceKey: 'worktree:wt-1'
    })
    const container = await renderSidebarNav()

    const newTaskButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New task"]'
    )

    expect(newTaskButton?.className).not.toContain('is-active')
    expect(newTaskButton?.getAttribute('aria-current')).toBeNull()
  })

  it('hides Artifacts from its context menu', async () => {
    setSidebarState({
      settings: { ...getDefaultSettings('/tmp'), showArtifactsButton: true }
    })
    const container = await renderSidebarNav()
    const row = getButtonByText(container, 'Artifacts')
    const menu = row.closest('[data-testid="context-menu"]')

    await clickButton(getHideButton(menu as Element))

    expect(mocks.updateSettings).toHaveBeenCalledWith({ showArtifactsButton: false })
  })

  it('hides Phone connection on sign-in and restores it on sign-out', async () => {
    const container = await renderSidebarNav()
    const queryPhone = (): HTMLButtonElement | undefined =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
        button.textContent?.startsWith('Phone connection')
      )
    expect(queryPhone()).toBeDefined()
    await clickButton(queryPhone()!)
    expect(mocks.openDeviceConnectionsPage).toHaveBeenCalledOnce()
    await act(async () =>
      mocks.accountStateChanged?.({
        configured: true,
        status: 'signed-in',
        persistence: 'encrypted',
        account: { accountId: 'account-1', displayName: 'Ada' }
      })
    )
    expect(queryPhone()).toBeUndefined()
    await act(async () =>
      mocks.accountStateChanged?.({ configured: true, status: 'signed-out', persistence: 'none' })
    )
    expect(queryPhone()).toBeDefined()
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('updates localized labels when the language changes after mount', async () => {
    const container = await renderSidebarNav()

    expect(queryButtonByText(container, 'Automations')).not.toBeNull()

    await act(async () => {
      await i18n.changeLanguage('zh')
    })

    expect(queryButtonByText(container, '自动化')).not.toBeNull()
  })

  it('updates labels when pseudo-localization is enabled after mount', async () => {
    const container = await renderSidebarNav()

    await act(async () => {
      await i18n.changeLanguage(PSEUDO_LOCALIZATION_LOCALE)
    })

    expect(queryButtonByText(container, '[Automations]')).not.toBeNull()
  })

  it('shows the Automations entry by default for older settings', () => {
    expect(shouldShowAutomationsButton(null)).toBe(true)
    expect(shouldShowAutomationsButton({})).toBe(true)
  })

  it('omits the Automations row when the sidebar setting is off', async () => {
    setSidebarState({
      settings: {
        ...getDefaultSettings('/tmp'),
        showAutomationsButton: false
      }
    })

    const container = await renderSidebarNav()

    expect(queryButtonByText(container, 'Automations')).toBeNull()
  })

  it('hides Automations from its sidebar context menu', async () => {
    const container = await renderSidebarNav()

    const automationsMenu = getButtonByText(container, 'Automations').closest(
      '[data-testid="context-menu"]'
    )
    expect(automationsMenu).not.toBeNull()

    await clickButton(getHideButton(automationsMenu as HTMLElement))

    expect(mocks.updateSettings).toHaveBeenCalledWith({ showAutomationsButton: false })
  })

  it('places the search above New task with its shortcut and original action', async () => {
    const container = await renderSidebarNav()
    const search = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Search worktrees and browser tabs"]'
    )!
    expect(search).not.toBeNull()
    expect(search.textContent).toContain('J')
    const newTask = container.querySelector('button[aria-label="New task"]')!
    expect(search.compareDocumentPosition(newTask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await clickButton(search)
    expect(mocks.openModal).toHaveBeenCalledWith('worktree-palette')
  })

  it('keeps task source shortcuts keyboard-reachable and revealed on Tasks row hover or focus', async () => {
    const container = await renderSidebarNav()

    const tasksButton = getButtonByText(container, 'Tasks')
    const githubShortcut = tasksButton.parentElement?.querySelector<HTMLButtonElement>(
      'button[aria-label="Open GitHub tasks"]'
    )
    expect(githubShortcut).not.toBeNull()
    expect(githubShortcut?.tabIndex).toBe(0)
    expect(tasksButton.contains(githubShortcut ?? null)).toBe(false)

    const shortcuts = githubShortcut?.parentElement
    expect(shortcuts?.className).toContain('can-hover:opacity-0')
    expect(shortcuts?.className).toContain('can-hover:group-hover:opacity-100')
    expect(shortcuts?.className).toContain('can-hover:group-focus-within:opacity-100')
  })

  it('hides available Tasks from its sidebar context menu', async () => {
    const container = await renderSidebarNav()

    const tasksButton = getButtonByText(container, 'Tasks')

    const tasksMenu = tasksButton.closest('[data-testid="context-menu"]')
    expect(tasksMenu).not.toBeNull()
    await clickButton(getHideButton(tasksMenu as HTMLElement))

    expect(mocks.updateSettings).toHaveBeenCalledWith({ showTasksButton: false })
  })

  it('keeps Tasks enabled with no git repos so the page can explain the empty state', async () => {
    setSidebarState({ repos: [folderRepo()] })
    const container = await renderSidebarNav()

    const tasksButton = getButtonByText(container, 'Tasks')
    expect(tasksButton.getAttribute('aria-disabled')).toBeNull()
    expect(tasksButton.disabled).toBe(false)
    expect(tasksButton.className).not.toContain('opacity-50')
    expect(
      tasksButton.parentElement?.querySelector('button[aria-label="Open GitHub tasks"]')
    ).not.toBeNull()

    await clickButton(tasksButton)
    expect(mocks.openTaskPage).toHaveBeenCalled()

    const tasksMenu = tasksButton.closest('[data-testid="context-menu"]')
    expect(tasksMenu).not.toBeNull()
    await clickButton(getHideButton(tasksMenu as HTMLElement))

    expect(mocks.updateSettings).toHaveBeenCalledWith({ showTasksButton: false })
  })
})
