// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLoginCapabilities: vi.fn(),
  getState: vi.fn(),
  signIn: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  onStateChanged: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  refreshDirectory: vi.fn(),
  refreshLocalOwnership: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error, warning: mocks.warning }
}))

vi.mock('./HiveAccountSignOutConfirmDialog', () => ({
  HiveAccountSignOutConfirmDialog: ({
    open,
    onConfirm
  }: {
    open: boolean
    onConfirm: () => void
  }) => (open ? <button onClick={onConfirm}>Confirm sign out</button> : null)
}))

import { HiveAccountSettingsPane } from './HiveAccountSettingsPane'
import type { HiveAccountState } from '../../../../shared/hive-account'

const signedInState = {
  configured: true,
  status: 'signed-in' as const,
  persistence: 'encrypted' as const,
  account: { accountId: '123e4567-e89b-42d3-a456-426614174000', displayName: 'Ada' },
  deviceLabel: 'workstation',
  expiresAt: Date.now() + 60_000,
  sessionExpiresAt: Date.now() + 90 * 24 * 60 * 60 * 1_000,
  sessionProfile: 'TRUSTED' as const
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveAccount: {
        getLoginCapabilities: mocks.getLoginCapabilities,
        getState: mocks.getState,
        signIn: mocks.signIn,
        refresh: mocks.refresh,
        signOut: mocks.signOut,
        onStateChanged: mocks.onStateChanged
      },
      hiveRuntimeCloud: {
        listSessions: mocks.listSessions,
        revokeSession: mocks.revokeSession,
        refreshDirectory: mocks.refreshDirectory,
        refreshLocalOwnership: mocks.refreshLocalOwnership
      },
      platform: {
        get: () => ({
          platform: 'win32',
          osRelease: '10.0.26100',
          arch: 'x64',
          shell: 'powershell.exe',
          displayServer: null
        })
      }
    }
  })
  for (const mock of Object.values(mocks)) {
    mock.mockReset()
  }
  mocks.getState.mockResolvedValue(signedInState)
  mocks.getLoginCapabilities.mockResolvedValue({
    contractRevision: 'hive-login-capabilities-v1',
    clientId: 'hivecode-desktop',
    defaultMethod: 'phone_sms',
    providers: []
  })
  mocks.onStateChanged.mockReturnValue(vi.fn())
  mocks.listSessions.mockResolvedValue([])
  mocks.refreshDirectory.mockResolvedValue({
    status: 'SIGNED_OUT',
    accountId: null,
    sessionGeneration: null,
    items: [],
    lastSyncedAt: null,
    errorCode: null
  })
  mocks.refreshLocalOwnership.mockResolvedValue({
    stateRevision: 0,
    relation: 'UNVERIFIABLE',
    accountId: null,
    sessionGeneration: null,
    runtimeRecordId: null,
    claimCapabilityAvailable: false,
    presence: 'WAITING_RUNTIME',
    checkedAt: null,
    errorCode: null
  })
  mocks.refresh.mockResolvedValue({ status: 'refreshed', state: signedInState })
  mocks.signOut.mockResolvedValue({
    status: 'remote-and-local',
    state: { configured: true, status: 'signed-out', persistence: 'encrypted' }
  })
})

afterEach(cleanup)

describe('HiveAccountSettingsPane', () => {
  it('does not let the initial state response overwrite a newer live state', async () => {
    const staleState: HiveAccountState = {
      configured: true,
      status: 'signed-out',
      persistence: 'encrypted'
    }
    let resolveInitialState: ((state: HiveAccountState) => void) | undefined
    let publishState: ((state: HiveAccountState) => void) | undefined
    mocks.getState.mockImplementation(
      () =>
        new Promise<HiveAccountState>((resolve) => {
          resolveInitialState = resolve
        })
    )
    mocks.onStateChanged.mockImplementation((listener: (state: HiveAccountState) => void) => {
      publishState = listener
      return vi.fn()
    })

    render(<HiveAccountSettingsPane />)
    await waitFor(() => expect(publishState).toBeTypeOf('function'))

    act(() => publishState?.(signedInState))
    expect(await screen.findByText('Ada')).toBeInTheDocument()

    await act(async () => {
      resolveInitialState?.(staleState)
      await Promise.resolve()
    })

    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in to HiveCloud' })).not.toBeInTheDocument()
  })

  it('shows the application account and manages its session', async () => {
    const user = userEvent.setup()
    const onOpenRuntimeDetails = vi.fn()
    render(<HiveAccountSettingsPane onOpenRuntimeDetails={onOpenRuntimeDetails} />)
    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('workstation')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More account actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Check connection' }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'View connection details' }))
    expect(onOpenRuntimeDetails).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Manage devices' }))
    expect(screen.getByRole('tab', { name: 'Sign-in devices 1' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await user.click(screen.getByRole('button', { name: 'Sign out of this device' }))
    await user.click(screen.getByRole('button', { name: 'Confirm sign out' }))
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })

  it('signs in without creating or switching a local profile', async () => {
    const user = userEvent.setup()
    const signedOut = { configured: true, status: 'signed-out', persistence: 'encrypted' }
    mocks.getState.mockResolvedValue(signedOut)
    mocks.signIn.mockResolvedValue({ status: 'signed-in', state: signedInState })
    render(<HiveAccountSettingsPane />)

    await user.click(await screen.findByRole('button', { name: 'Sign in to HiveCloud' }))
    expect(
      screen.getByRole('heading', { name: /登录 HiveCloud|Sign in to HiveCloud/ })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /浏览器登录|Browser/ }))
    await user.click(screen.getByRole('button', { name: /在浏览器中继续|Continue in browser/ }))
    expect(mocks.signIn).toHaveBeenCalledWith({ sessionProfile: 'TRUSTED' })
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
  })

  it('does not expose a pre-auth trust toggle and uses a persistent session', async () => {
    const user = userEvent.setup()
    mocks.getState.mockResolvedValue({
      configured: true,
      status: 'signed-out',
      persistence: 'encrypted'
    })
    mocks.signIn.mockResolvedValue({ status: 'signed-in', state: signedInState })
    render(<HiveAccountSettingsPane />)

    await user.click(await screen.findByRole('button', { name: 'Sign in to HiveCloud' }))
    expect(
      screen.queryByRole('checkbox', { name: /信任此设备|Trust this device/i })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /浏览器登录|Browser/ }))
    await user.click(screen.getByRole('button', { name: /在浏览器中继续|Continue in browser/ }))

    expect(mocks.signIn).toHaveBeenCalledWith({ sessionProfile: 'TRUSTED' })
  })

  it('shows only advertised providers and routes them through the existing sign-in flow', async () => {
    const user = userEvent.setup()
    mocks.getState.mockResolvedValue({
      configured: true,
      status: 'signed-out',
      persistence: 'encrypted'
    })
    mocks.getLoginCapabilities.mockResolvedValue({
      contractRevision: 'hive-login-capabilities-v1',
      clientId: 'hivecode-desktop',
      defaultMethod: 'phone_sms',
      providers: [
        {
          id: 'github',
          authorizationPath: '/hive/v1/auth/provider-authorizations/github'
        }
      ]
    })
    mocks.signIn.mockResolvedValue({ status: 'signed-in', state: signedInState })
    render(<HiveAccountSettingsPane />)

    await user.click(await screen.findByRole('button', { name: 'Sign in to HiveCloud' }))
    const github = await screen.findByRole('button', { name: /GitHub/ })
    expect(screen.queryByRole('button', { name: /微信/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /QQ/ })).not.toBeInTheDocument()

    await user.click(github)
    expect(mocks.signIn).not.toHaveBeenCalled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(github)

    expect(mocks.signIn).toHaveBeenCalledWith({
      sessionProfile: 'TRUSTED',
      providerId: 'github'
    })
  })

  it('hides the entire provider section when no providers are advertised', async () => {
    const user = userEvent.setup()
    mocks.getState.mockResolvedValue({
      configured: true,
      status: 'signed-out',
      persistence: 'encrypted'
    })
    render(<HiveAccountSettingsPane />)

    await user.click(await screen.findByRole('button', { name: 'Sign in to HiveCloud' }))
    await waitFor(() => expect(mocks.getLoginCapabilities).toHaveBeenCalledOnce())

    expect(screen.queryByText('其他登录方式')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /GitHub/ })).not.toBeInTheDocument()
  })

  it('disables cloud login when secure storage is unavailable', async () => {
    const user = userEvent.setup()
    mocks.getState.mockResolvedValue({
      configured: true,
      status: 'error',
      persistence: 'none',
      errorCode: 'secure_storage_unavailable'
    })
    render(<HiveAccountSettingsPane />)
    expect(await screen.findByText(/secure storage is unavailable/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in to HiveCloud' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'View troubleshooting' }))
    expect(
      screen.getByRole('heading', { name: 'Restore system secure storage' })
    ).toBeInTheDocument()
  })

  it('does not present an expired account or its Runtime as online', async () => {
    mocks.getState.mockResolvedValue({
      ...signedInState,
      errorCode: 'session_expired'
    })

    render(<HiveAccountSettingsPane />)

    expect((await screen.findAllByText('Authorization expired')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sign-in required')).toHaveLength(2)
    expect(screen.queryByText('Online')).not.toBeInTheDocument()
  })
})
