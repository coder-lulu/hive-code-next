// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { HiveAccountState } from '../../../../shared/hive-account'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  getAccountState: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  accountStateChanged: null as ((state: HiveAccountState) => void) | null,
  unsubscribeAccountState: vi.fn(),
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn(),
  openActivityPage: vi.fn(),
  openMobilePage: vi.fn(),
  updateSettings: vi.fn(),
  dismissMobileBadge: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

vi.mock('./SidebarNav', () => ({
  shouldShowAgentsButton: (settings: GlobalSettings | null) =>
    settings?.experimentalActivity === true,
  shouldShowMobileButton: (settings: GlobalSettings | null) => settings?.showMobileButton !== false
}))

vi.mock('./mobile-sidebar-onboarding-badge', () => ({
  useMobileSidebarOnboardingBadge: () => ({
    visible: false,
    dismiss: mocks.dismissMobileBadge
  })
}))

vi.mock('./sidebar-nav-controls', () => ({
  HideSidebarMenu: ({ onHide }: { onHide: () => void }) => (
    <button type="button" onClick={onHide}>
      Hide from sidebar
    </button>
  )
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  )
}))

vi.mock('../settings/HiveAccountSignInConfirmDialog', () => ({
  HiveAccountSignInConfirmDialog: ({
    open,
    onConfirm
  }: {
    open: boolean
    onConfirm: (sessionProfile: 'TEMPORARY' | 'TRUSTED') => void
  }) =>
    open ? (
      <button type="button" onClick={() => onConfirm('TRUSTED')}>
        Approve sign-in
      </button>
    ) : null
}))

vi.mock('../settings/HiveAccountSignOutConfirmDialog', () => ({
  HiveAccountSignOutConfirmDialog: ({
    open,
    onConfirm
  }: {
    open: boolean
    onConfirm: () => void
  }) =>
    open ? (
      <button type="button" onClick={onConfirm}>
        Confirm sign out
      </button>
    ) : null
}))

import SidebarFooter from './SidebarFooter'

const roots: Root[] = []

function setState(settings = getDefaultSettings('/tmp')): void {
  mocks.state = {
    settings,
    activeView: 'terminal',
    openSettingsPage: mocks.openSettingsPage,
    openSettingsTarget: mocks.openSettingsTarget,
    openActivityPage: mocks.openActivityPage,
    openMobilePage: mocks.openMobilePage,
    updateSettings: mocks.updateSettings
  }
}

async function renderFooter(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(<SidebarFooter />))
  return container
}

describe('SidebarFooter', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    mocks.accountStateChanged = null
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        hiveAccount: {
          getState: mocks.getAccountState,
          signIn: mocks.signIn,
          signOut: mocks.signOut,
          onStateChanged: (callback: (state: HiveAccountState) => void) => {
            mocks.accountStateChanged = callback
            return mocks.unsubscribeAccountState
          }
        }
      }
    })
    mocks.getAccountState.mockResolvedValue({
      configured: true,
      status: 'signed-out',
      persistence: 'encrypted'
    })
    mocks.signOut.mockResolvedValue({
      status: 'remote-and-local',
      state: { configured: true, status: 'signed-out', persistence: 'encrypted' }
    })
    setState()
  })

  afterEach(() => {
    roots.splice(0).forEach((root) => act(() => root.unmount()))
    document.body.replaceChildren()
  })

  it('renders a direct sign-in action with the notification and mobile controls', async () => {
    const container = await renderFooter()
    const accountTrigger = container.querySelector<HTMLElement>('[data-sidebar-account-trigger]')

    expect(accountTrigger?.textContent).toContain('登录')
    expect(accountTrigger?.className).toContain('bg-transparent')
    expect(accountTrigger?.className).toContain('hover:bg-worktree-sidebar-foreground/7')
    expect(container.querySelector('button[aria-label="Notifications"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label$=" Mobile"]')).not.toBeNull()
  })

  it('opens the secure sign-in confirmation and replaces the CTA with the connected identity', async () => {
    mocks.signIn.mockResolvedValue({
      status: 'signed-in',
      state: {
        configured: true,
        status: 'signed-in',
        persistence: 'encrypted',
        account: { accountId: 'account-1', displayName: 'Ada' }
      }
    })
    const container = await renderFooter()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-sidebar-account-trigger]')?.click()
    )
    const approve = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Approve sign-in'
    )
    expect(approve).toBeDefined()

    await act(async () => approve?.click())

    expect(mocks.signIn).toHaveBeenCalledWith({ sessionProfile: 'TRUSTED' })
    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain('Ada')
    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain(
      'Signed in'
    )
    expect(
      container.querySelector('[data-sidebar-account-trigger] [data-account-avatar]')
    ).not.toBeNull()
    expect(container.querySelector('[data-sidebar-account-trigger]')?.className).toContain(
      'bg-transparent'
    )
    expect(container.querySelector('[data-sidebar-account-trigger]')?.className).toContain(
      'hover:bg-worktree-sidebar-foreground/7'
    )
  })

  it('routes account and notification actions into their settings panes', async () => {
    mocks.getAccountState.mockResolvedValue({
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      account: { accountId: 'account-1', displayName: 'Ada' }
    })
    const container = await renderFooter()
    const account = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Account'
    )
    const notifications = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Notifications"]'
    )

    await act(async () => account?.click())
    expect(mocks.openSettingsTarget).toHaveBeenCalledWith({ pane: 'orca-account', repoId: null })

    await act(async () => notifications?.click())
    expect(mocks.openSettingsTarget).toHaveBeenCalledWith({ pane: 'notifications', repoId: null })
    expect(mocks.openSettingsPage).toHaveBeenCalledTimes(2)
  })

  it('offers a separated sign-out action and returns the footer to sign-in state', async () => {
    mocks.getAccountState.mockResolvedValue({
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      account: { accountId: 'account-1', displayName: 'Ada' }
    })
    const container = await renderFooter()
    const signOut = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Sign out'
    )

    await act(async () => signOut?.click())
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Confirm sign out'
    )
    expect(confirm).toBeDefined()

    await act(async () => confirm?.click())

    expect(mocks.signOut).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain('登录')
  })

  it('keeps the authoritative account state and reports an IPC sign-out failure', async () => {
    const connectedState = {
      configured: true,
      status: 'signed-in' as const,
      persistence: 'encrypted' as const,
      account: { accountId: 'account-1', displayName: 'Ada' }
    }
    mocks.getAccountState.mockResolvedValue(connectedState)
    mocks.signOut.mockRejectedValue(new Error('credential delete failed'))
    const container = await renderFooter()
    const signOut = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Sign out'
    )

    await act(async () => signOut?.click())
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Confirm sign out'
    )
    await act(async () => confirm?.click())

    expect(mocks.toastError).toHaveBeenCalledOnce()
    expect(mocks.getAccountState).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain('Ada')
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent === 'Confirm sign out'
      )
    ).toBe(true)
  })

  it('warns when sign-out only clears the local session', async () => {
    mocks.getAccountState.mockResolvedValue({
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      account: { accountId: 'account-1', displayName: 'Ada' }
    })
    mocks.signOut.mockResolvedValue({
      status: 'local-only',
      state: { configured: true, status: 'signed-out', persistence: 'encrypted' }
    })
    const container = await renderFooter()
    const signOut = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Sign out'
    )

    await act(async () => signOut?.click())
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Confirm sign out'
    )
    await act(async () => confirm?.click())

    expect(mocks.toastWarning).toHaveBeenCalledOnce()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain('登录')
  })

  it('updates immediately when the main process broadcasts an account state change', async () => {
    const container = await renderFooter()

    await act(async () => {
      mocks.accountStateChanged?.({
        configured: true,
        status: 'signed-in',
        persistence: 'encrypted',
        account: { accountId: 'account-1', displayName: 'Grace' }
      })
    })

    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain(
      'Grace'
    )
  })

  it('uses the activity page when the activity feature is enabled', async () => {
    setState({ ...getDefaultSettings('/tmp'), experimentalActivity: true })
    const container = await renderFooter()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Activity"]')?.click()
    )

    expect(mocks.openActivityPage).toHaveBeenCalledOnce()
    expect(mocks.openSettingsTarget).not.toHaveBeenCalled()
  })

  it('opens Mobile from the footer and dismisses its onboarding badge', async () => {
    const container = await renderFooter()
    const mobile = container.querySelector<HTMLButtonElement>('button[aria-label$=" Mobile"]')

    await act(async () => mobile?.click())

    expect(mocks.dismissMobileBadge).toHaveBeenCalledOnce()
    expect(mocks.openMobilePage).toHaveBeenCalledOnce()
  })

  it('exposes Mobile as the current page to assistive technology', async () => {
    setState()
    mocks.state.activeView = 'mobile'
    const container = await renderFooter()

    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label$=" Mobile"]')
        ?.getAttribute('aria-current')
    ).toBe('page')
  })
})
