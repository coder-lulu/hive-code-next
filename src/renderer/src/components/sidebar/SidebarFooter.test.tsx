// @vitest-environment happy-dom
/* eslint-disable max-lines -- Covers the complete sidebar account lifecycle with shared bridge mocks. */

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
  toastInfo: vi.fn(),
  appRestart: vi.fn(),
  updaterCheck: vi.fn(),
  updaterGetVersion: vi.fn(),
  claimLocalRuntime: vi.fn(),
  refreshRuntimeCloud: vi.fn(),
  refreshLocalRuntimeOwnership: vi.fn(),
  accountStateChanged: null as ((state: HiveAccountState) => void) | null,
  unsubscribeAccountState: vi.fn(),
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn(),
  openActivityPage: vi.fn(),
  openDeviceConnectionsPage: vi.fn(),
  updateSettings: vi.fn(),
  dismissMobileBadge: vi.fn(),
  preloadHiveAccountSettings: vi.fn(),
  confirmAction: vi.fn(),
  activityUnreadCount: 0
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
    info: mocks.toastInfo
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

vi.mock('@/components/confirmation-dialog-context', () => ({
  useConfirmationDialog: () => mocks.confirmAction
}))

vi.mock('@/components/activity/useActivityUnreadCount', () => ({
  useActivityUnreadCount: () => mocks.activityUnreadCount
}))

vi.mock('./SidebarNav', () => ({
  shouldShowAgentsButton: (settings: GlobalSettings | null) =>
    settings?.experimentalActivity === true
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
  DropdownMenuItem: ({
    children,
    disabled,
    onPointerDown,
    onSelect,
    'data-local-runtime-ownership': localRuntimeOwnership
  }: {
    children: ReactNode
    disabled?: boolean
    onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void
    onSelect?: () => void
    'data-local-runtime-ownership'?: string
  }) => (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={onPointerDown}
      onClick={onSelect}
      data-local-runtime-ownership={localRuntimeOwnership}
    >
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

vi.mock('../settings/settings-page-loader', () => ({
  preloadHiveAccountSettings: mocks.preloadHiveAccountSettings
}))

vi.mock('./SidebarFeedbackDialog', () => ({
  SidebarFeedbackDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Feedback dialog</div> : null
}))

import { AccountRuntimeClaimError } from '@/store/slices/account-runtime-cloud'
import SidebarFooter from './SidebarFooter'

const roots: Root[] = []

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function setState(settings = getDefaultSettings('/tmp')): void {
  mocks.state = {
    settings,
    activeView: 'terminal',
    openSettingsPage: mocks.openSettingsPage,
    openSettingsTarget: mocks.openSettingsTarget,
    openActivityPage: mocks.openActivityPage,
    openDeviceConnectionsPage: mocks.openDeviceConnectionsPage,
    updateSettings: mocks.updateSettings,
    updateStatus: { state: 'idle' },
    accountRuntimeDirectory: {
      status: 'SIGNED_OUT',
      accountId: null,
      sessionGeneration: null,
      items: [],
      lastSyncedAt: null,
      errorCode: null
    },
    localRuntimeOwnership: {
      stateRevision: 0,
      relation: 'UNVERIFIABLE',
      accountId: null,
      sessionGeneration: null,
      runtimeRecordId: null,
      claimCapabilityAvailable: false,
      presence: 'WAITING_RUNTIME',
      checkedAt: null,
      errorCode: null
    },
    refreshAccountRuntimeCloud: mocks.refreshRuntimeCloud,
    refreshLocalRuntimeOwnership: mocks.refreshLocalRuntimeOwnership,
    claimLocalRuntimeForAccount: mocks.claimLocalRuntime
  }
}

async function renderFooter(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<SidebarFooter />)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
  return container
}

describe('SidebarFooter', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    const accountListeners = new Set<(state: HiveAccountState) => void>()
    mocks.accountStateChanged = (state) => accountListeners.forEach((listener) => listener(state))
    mocks.activityUnreadCount = 0
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        app: {
          restart: mocks.appRestart
        },
        hiveAccount: {
          getState: mocks.getAccountState,
          signIn: mocks.signIn,
          signOut: mocks.signOut,
          onStateChanged: (callback: (state: HiveAccountState) => void) => {
            accountListeners.add(callback)
            return () => {
              accountListeners.delete(callback)
              mocks.unsubscribeAccountState()
            }
          }
        },
        hiveRuntimeCloud: {
          getDirectory: vi.fn(),
          refreshDirectory: vi.fn(),
          getLocalOwnership: vi.fn(),
          refreshLocalOwnership: vi.fn(),
          claimLocalRuntime: vi.fn(),
          onDirectoryChanged: vi.fn(),
          onOwnershipChanged: vi.fn()
        },
        updater: {
          check: mocks.updaterCheck,
          getVersion: mocks.updaterGetVersion
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
    mocks.appRestart.mockResolvedValue(undefined)
    mocks.confirmAction.mockResolvedValue(true)
    mocks.updaterCheck.mockResolvedValue(undefined)
    mocks.updaterGetVersion.mockResolvedValue('1.5.0-beta.7')
    mocks.refreshRuntimeCloud.mockResolvedValue(undefined)
    mocks.refreshLocalRuntimeOwnership.mockResolvedValue({
      stateRevision: 1,
      relation: 'UNREGISTERED',
      accountId: 'account-1',
      sessionGeneration: 1,
      runtimeRecordId: null,
      claimCapabilityAvailable: false,
      presence: 'ONLINE',
      checkedAt: 1,
      errorCode: null
    })
    mocks.claimLocalRuntime.mockResolvedValue({
      stateRevision: 2,
      relation: 'CLAIMED_BY_CURRENT',
      accountId: 'account-1',
      sessionGeneration: 1,
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      claimCapabilityAvailable: false,
      presence: 'ONLINE',
      checkedAt: 1,
      errorCode: null
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

    expect(accountTrigger?.textContent).toContain('Sign in to HiveCloud')
    expect(container.querySelector('button[aria-label="Notifications"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="Phone connection"]')).not.toBeNull()
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

    const signIn = container.querySelector<HTMLButtonElement>('.hive-account-primary')
    expect(signIn).toBeDefined()
    await act(async () => signIn?.click())
    const approve = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Approve sign-in'
    )
    expect(approve).toBeDefined()

    await act(async () => approve?.click())

    expect(mocks.signIn).toHaveBeenCalledWith({ sessionProfile: 'TRUSTED' })
    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain('Ada')
    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain(
      'HiveCloud connected'
    )
    expect(
      container.querySelector('[data-sidebar-account-trigger] [data-account-avatar]')
    ).not.toBeNull()
    expect(container.textContent).toContain('Work account')
    expect(container.textContent).not.toContain('HiveKernel')
  })

  it('routes account and notification actions into their settings panes', async () => {
    mocks.getAccountState.mockResolvedValue({
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      account: { accountId: 'account-1', displayName: 'Ada' }
    })
    const container = await renderFooter()
    const account = container.querySelector<HTMLButtonElement>('[data-account-center-entry]')
    const notifications = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Notifications"]'
    )

    await act(async () => account?.click())
    expect(mocks.openSettingsTarget).toHaveBeenCalledWith({ pane: 'orca-account', repoId: null })
    expect(mocks.preloadHiveAccountSettings).toHaveBeenCalledOnce()

    await act(async () => notifications?.click())
    expect(mocks.openSettingsTarget).toHaveBeenCalledWith({ pane: 'notifications', repoId: null })
    expect(mocks.openSettingsPage).toHaveBeenCalledTimes(2)
  })

  it('preloads account settings before account-center navigation', async () => {
    const container = await renderFooter()
    const trigger = container.querySelector<HTMLButtonElement>('[data-sidebar-account-trigger]')

    await act(async () => {
      trigger?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
      trigger?.focus()
    })

    expect(mocks.preloadHiveAccountSettings).toHaveBeenCalledTimes(2)
  })

  it('shows the live activity unread count in the notification menu row', async () => {
    mocks.activityUnreadCount = 3
    setState({ ...getDefaultSettings('/tmp'), experimentalActivity: true })
    mocks.getAccountState.mockResolvedValue({
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      account: { accountId: 'account-1', displayName: 'Ada' }
    })

    const container = await renderFooter()
    const unread = container.querySelector<HTMLElement>('[data-notification-unread="true"]')

    expect(unread?.textContent).toBe('3 unread')
  })

  it('labels the fallback as notification settings without claiming an unread state', async () => {
    const container = await renderFooter()

    expect(container.textContent).toContain('Notification settings')
    expect(container.querySelector('[data-notification-unread]')).toBeNull()
  })

  it('exposes the selected appearance option and keyboard-managed toggle group semantics', async () => {
    const container = await renderFooter()
    const themeGroup = container.querySelector('[aria-label="Theme"]')
    const options = themeGroup?.querySelectorAll<HTMLButtonElement>('button')

    expect(themeGroup?.getAttribute('role')).toBe('radiogroup')
    expect(options).toHaveLength(3)
    expect(options?.[0]?.getAttribute('aria-checked')).toBe('true')
    expect(options?.[1]?.getAttribute('aria-checked')).toBe('false')
    expect(options?.[2]?.getAttribute('aria-checked')).toBe('false')

    await act(async () => {
      options?.[0]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      )
    })
    expect(mocks.updateSettings).toHaveBeenCalledWith({ theme: 'light' })
  })

  it('keeps the installed version visible while an update check is running', async () => {
    setState()
    mocks.state.updateStatus = { state: 'checking' }
    const container = await renderFooter()

    expect(container.textContent).toContain('1.5.0-beta.7')
  })

  it('shows the installed version and marks an available update with a dot', async () => {
    const current = await renderFooter()
    expect(current.textContent).toContain('1.5.0-beta.7')
    expect(current.querySelector('.hive-account-update-dot')).toBeNull()

    roots.splice(-1).forEach((root) => act(() => root.unmount()))
    setState()
    mocks.state.updateStatus = {
      state: 'available',
      version: '1.5.0-beta.8',
      changelog: null
    }
    const available = await renderFooter()
    expect(available.textContent).toContain('1.5.0-beta.7')
    expect(available.textContent).not.toContain('New version 1.5.0-beta.8')
    expect(available.querySelector('.hive-account-update-dot')).not.toBeNull()
  })

  it('uses the identity header as the only account-center entry', async () => {
    mocks.getAccountState.mockResolvedValue({
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      account: { accountId: 'account-1', displayName: 'Ada' }
    })

    const container = await renderFooter()

    expect(container.textContent).not.toContain('HiveCloud connection')
    expect(container.textContent).not.toContain('Storage and resources')
    expect(container.textContent).not.toContain('Account center')
    expect(container.textContent).not.toContain('Devices and sessions')
    expect(container.textContent).not.toContain('This computer')
    expect(container.querySelectorAll('[data-account-center-entry]')).toHaveLength(1)
    expect(container.querySelector('[data-local-runtime-ownership]')).not.toBeNull()
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
    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain(
      'Sign in to HiveCloud'
    )
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
    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain(
      'Sign in to HiveCloud'
    )
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

  it('does not let the initial account read overwrite a newer live state', async () => {
    const initialRead = deferred<HiveAccountState>()
    mocks.getAccountState.mockReturnValueOnce(initialRead.promise)
    const container = await renderFooter()

    await act(async () => {
      mocks.accountStateChanged?.({
        configured: true,
        status: 'signed-in',
        persistence: 'encrypted',
        account: { accountId: 'account-1', displayName: 'Grace' }
      })
    })
    await act(async () => {
      initialRead.resolve({
        configured: true,
        status: 'signed-out',
        persistence: 'encrypted'
      })
      await initialRead.promise
    })

    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain(
      'Grace'
    )
  })

  it('does not let a focus refresh overwrite a newer live state', async () => {
    const container = await renderFooter()
    const focusRead = deferred<HiveAccountState>()
    mocks.getAccountState.mockReturnValueOnce(focusRead.promise)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })
    await act(async () => {
      mocks.accountStateChanged?.({
        configured: true,
        status: 'signed-in',
        persistence: 'encrypted',
        account: { accountId: 'account-1', displayName: 'Grace' }
      })
    })
    await act(async () => {
      focusRead.resolve({
        configured: true,
        status: 'signed-out',
        persistence: 'encrypted'
      })
      await focusRead.promise
    })

    expect(container.querySelector('[data-sidebar-account-trigger]')?.textContent).toContain(
      'Grace'
    )
  })

  it('offers an explicit computer claim only after account sign-in', async () => {
    setState()
    mocks.state.localRuntimeOwnership = {
      ...(mocks.state.localRuntimeOwnership as Record<string, unknown>),
      relation: 'UNREGISTERED',
      accountId: 'account-1'
    }
    const container = await renderFooter()
    await act(async () => {
      mocks.accountStateChanged?.({
        configured: true,
        status: 'signed-in',
        persistence: 'encrypted',
        account: { accountId: 'account-1', displayName: 'Ada' }
      })
    })
    await vi.waitFor(() =>
      expect(container.querySelector('[data-local-runtime-ownership]')).not.toBeNull()
    )
    const claim = container.querySelector<HTMLButtonElement>('[data-local-runtime-ownership]')

    expect(claim?.getAttribute('data-local-runtime-ownership')).toBe('UNREGISTERED')
    expect(claim?.textContent).toContain('Not claimed · Claim device')
    await act(async () => claim?.click())

    expect(mocks.claimLocalRuntime).toHaveBeenCalledOnce()
    expect(mocks.claimLocalRuntime).toHaveBeenCalledWith('account-1')
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'This computer is now available through your HiveCloud account.'
    )
    expect(mocks.openSettingsTarget).not.toHaveBeenCalled()
    expect(container.querySelector('[data-local-runtime-ownership]')?.textContent).toContain(
      'Claim successful'
    )
  })

  it('renders claimed ownership as a lightweight status in the identity header', async () => {
    setState()
    mocks.state.localRuntimeOwnership = {
      ...(mocks.state.localRuntimeOwnership as Record<string, unknown>),
      relation: 'CLAIMED_BY_CURRENT',
      accountId: 'account-1'
    }
    mocks.getAccountState.mockResolvedValue({
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      account: { accountId: 'account-1', displayName: 'Ada' }
    })

    const container = await renderFooter()
    const claimed = container.querySelector<HTMLElement>('[data-local-runtime-ownership]')

    expect(claimed?.tagName).toBe('SPAN')
    expect(claimed?.getAttribute('role')).toBe('status')
    expect(claimed?.textContent).toContain('Claimed')
  })

  it('keeps a failed claim in the header with a retry action', async () => {
    setState()
    mocks.state.localRuntimeOwnership = {
      ...(mocks.state.localRuntimeOwnership as Record<string, unknown>),
      relation: 'UNREGISTERED',
      accountId: 'account-1'
    }
    mocks.getAccountState.mockResolvedValue({
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      account: { accountId: 'account-1', displayName: 'Ada' }
    })
    mocks.claimLocalRuntime.mockRejectedValue(new AccountRuntimeClaimError('OWNERSHIP_UNAVAILABLE'))

    const container = await renderFooter()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-local-runtime-ownership]')?.click()
    )

    const retry = container.querySelector<HTMLButtonElement>('[data-local-runtime-ownership]')
    expect(retry?.textContent).toContain('Claim failed · Retry')
    expect(retry?.getAttribute('aria-label')).toContain("Couldn't claim this computer")
    expect(mocks.openSettingsTarget).not.toHaveBeenCalled()
  })

  it('refreshes an unverifiable ownership state and claims with the same click', async () => {
    setState()
    const container = await renderFooter()
    await act(async () => {
      mocks.accountStateChanged?.({
        configured: true,
        status: 'signed-in',
        persistence: 'encrypted',
        account: { accountId: 'account-1', displayName: 'Ada' }
      })
    })
    const claim = container.querySelector<HTMLButtonElement>('[data-local-runtime-ownership]')

    expect(claim?.getAttribute('data-local-runtime-ownership')).toBe('UNVERIFIABLE')
    await act(async () => claim?.click())

    expect(mocks.refreshLocalRuntimeOwnership).toHaveBeenCalledOnce()
    expect(mocks.claimLocalRuntime).toHaveBeenCalledOnce()
    expect(mocks.toastSuccess).toHaveBeenCalledOnce()
  })

  it('does not report success for a claim reply from another account', async () => {
    setState()
    mocks.state.localRuntimeOwnership = {
      ...(mocks.state.localRuntimeOwnership as Record<string, unknown>),
      relation: 'UNREGISTERED',
      accountId: 'account-1'
    }
    mocks.claimLocalRuntime.mockResolvedValue({
      stateRevision: 2,
      relation: 'CLAIMED_BY_CURRENT',
      accountId: 'account-2',
      sessionGeneration: 2,
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      claimCapabilityAvailable: false,
      presence: 'ONLINE',
      checkedAt: 2,
      errorCode: null
    })
    const container = await renderFooter()
    await act(async () => {
      mocks.accountStateChanged?.({
        configured: true,
        status: 'signed-in',
        persistence: 'encrypted',
        account: { accountId: 'account-1', displayName: 'Ada' }
      })
    })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-local-runtime-ownership]')?.click()
    )

    expect(mocks.toastError).toHaveBeenCalledWith(
      'The account changed during verification. Sign in with the original account and try again.'
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('does not open password sign-in when a claim is rejected', async () => {
    setState()
    mocks.state.localRuntimeOwnership = {
      ...(mocks.state.localRuntimeOwnership as Record<string, unknown>),
      relation: 'PENDING_CLAIM',
      accountId: 'account-1'
    }
    mocks.claimLocalRuntime.mockRejectedValue(new AccountRuntimeClaimError('STEP_UP_REQUIRED'))
    const container = await renderFooter()
    await act(async () =>
      mocks.accountStateChanged?.({
        configured: true,
        status: 'signed-in',
        persistence: 'encrypted',
        account: { accountId: 'account-1', displayName: 'Ada' }
      })
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-local-runtime-ownership]')?.click()
    )
    expect(mocks.claimLocalRuntime).toHaveBeenCalledOnce()
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('coalesces rapid repeated claim clicks into one request', async () => {
    setState()
    mocks.state.localRuntimeOwnership = {
      ...(mocks.state.localRuntimeOwnership as Record<string, unknown>),
      relation: 'UNREGISTERED',
      accountId: 'account-1'
    }
    const claimResult = deferred<{
      stateRevision: number
      relation: 'CLAIMED_BY_CURRENT'
      accountId: string
      sessionGeneration: number
      runtimeRecordId: string
      claimCapabilityAvailable: false
      presence: 'ONLINE'
      checkedAt: number
      errorCode: null
    }>()
    mocks.claimLocalRuntime.mockReturnValue(claimResult.promise)
    const container = await renderFooter()
    await act(async () => {
      mocks.accountStateChanged?.({
        configured: true,
        status: 'signed-in',
        persistence: 'encrypted',
        account: { accountId: 'account-1', displayName: 'Ada' }
      })
    })
    const claim = container.querySelector<HTMLButtonElement>('[data-local-runtime-ownership]')

    await act(async () => {
      claim?.click()
      claim?.click()
      await Promise.resolve()
    })
    expect(mocks.claimLocalRuntime).toHaveBeenCalledOnce()

    await act(async () => {
      claimResult.resolve({
        stateRevision: 2,
        relation: 'CLAIMED_BY_CURRENT',
        accountId: 'account-1',
        sessionGeneration: 1,
        runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
        claimCapabilityAvailable: false,
        presence: 'ONLINE',
        checkedAt: 2,
        errorCode: null
      })
      await claimResult.promise
    })
    expect(mocks.toastSuccess).toHaveBeenCalledOnce()
  })

  it('does not expose account ownership actions while signed out', async () => {
    const container = await renderFooter()

    expect(container.querySelector('[data-local-runtime-ownership]')).toBeNull()
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

  it('updates the footer shortcut on account sign-in and sign-out', async () => {
    const container = await renderFooter()
    expect(container.querySelector('button[aria-label="Phone connection"]')).not.toBeNull()
    await act(async () =>
      mocks.accountStateChanged?.({
        configured: true,
        status: 'signed-in',
        persistence: 'encrypted',
        account: { accountId: 'account-1', displayName: 'Ada' }
      })
    )
    expect(container.querySelector('button[aria-label="Phone connection"]')).toBeNull()
    await act(async () =>
      mocks.accountStateChanged?.({ configured: true, status: 'signed-out', persistence: 'none' })
    )
    expect(container.querySelector('button[aria-label="Phone connection"]')).not.toBeNull()
  })

  it('opens Phone connection from the footer and dismisses its onboarding badge', async () => {
    const container = await renderFooter()
    const mobile = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Phone connection"]'
    )

    await act(async () => mobile?.click())

    expect(mocks.dismissMobileBadge).toHaveBeenCalledOnce()
    expect(mocks.openDeviceConnectionsPage).toHaveBeenCalledOnce()
  })

  it('exposes Phone connection as the current page to assistive technology', async () => {
    setState()
    mocks.state.activeView = 'device-connections'
    const container = await renderFooter()

    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Phone connection"]')
        ?.getAttribute('aria-current')
    ).toBe('page')
  })

  it('checks for updates from the account menu through the updater bridge', async () => {
    const container = await renderFooter()
    const checkForUpdates = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Check for updates')
    )

    expect(checkForUpdates).toBeDefined()
    await act(async () => checkForUpdates?.click())

    expect(mocks.updaterCheck).toHaveBeenCalledOnce()
    expect(mocks.updaterCheck).toHaveBeenCalledWith({
      includePrerelease: false,
      includePerfPrerelease: false
    })
  })

  it('keeps update-check modifier options on the account menu action', async () => {
    const container = await renderFooter()
    const checkForUpdates = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Check for updates')
    )

    expect(checkForUpdates).toBeDefined()
    await act(async () => {
      checkForUpdates?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, shiftKey: true })
      )
      checkForUpdates?.click()
    })

    expect(mocks.updaterCheck).toHaveBeenCalledWith({
      includePrerelease: true,
      includePerfPrerelease: false
    })
  })

  it('restarts HiveCode from the account menu through the app bridge', async () => {
    const container = await renderFooter()
    const restart = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Restart HiveCode')
    )

    expect(restart).toBeDefined()
    await act(async () => restart?.click())

    expect(mocks.confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Restart HiveCode?',
        description: 'Unsaved work may be lost.'
      })
    )
    expect(mocks.appRestart).toHaveBeenCalledOnce()
    expect(mocks.toastInfo).toHaveBeenCalledOnce()
  })

  it('does not restart HiveCode when confirmation is cancelled', async () => {
    mocks.confirmAction.mockResolvedValue(false)
    const container = await renderFooter()
    const restart = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Restart HiveCode')
    )

    await act(async () => restart?.click())

    expect(mocks.confirmAction).toHaveBeenCalledOnce()
    expect(mocks.appRestart).not.toHaveBeenCalled()
  })

  it('opens the existing feedback dialog from the support group', async () => {
    const container = await renderFooter()
    const feedback = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Help and feedback')
    )

    await act(async () => feedback?.click())

    expect(container.querySelector('[role="dialog"]')?.textContent).toBe('Feedback dialog')
  })
})
