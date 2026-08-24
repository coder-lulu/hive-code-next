// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  signIn: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
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
        getState: mocks.getState,
        signIn: mocks.signIn,
        refresh: mocks.refresh,
        signOut: mocks.signOut
      }
    }
  })
  for (const mock of Object.values(mocks)) {
    mock.mockReset()
  }
  mocks.getState.mockResolvedValue(signedInState)
  mocks.refresh.mockResolvedValue({ status: 'refreshed', state: signedInState })
  mocks.signOut.mockResolvedValue({
    status: 'remote-and-local',
    state: { configured: true, status: 'signed-out', persistence: 'encrypted' }
  })
})

afterEach(cleanup)

describe('HiveAccountSettingsPane', () => {
  it('shows the application account and manages its session', async () => {
    const user = userEvent.setup()
    render(<HiveAccountSettingsPane />)
    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('workstation')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
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
    expect(screen.getByText('Approve HiveCloud sign-in')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve sign-in' }))
    expect(mocks.signIn).toHaveBeenCalledWith({ sessionProfile: 'TEMPORARY' })
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
  })

  it('requires an explicit approval before creating a trusted session', async () => {
    const user = userEvent.setup()
    mocks.getState.mockResolvedValue({
      configured: true,
      status: 'signed-out',
      persistence: 'encrypted'
    })
    mocks.signIn.mockResolvedValue({ status: 'signed-in', state: signedInState })
    render(<HiveAccountSettingsPane />)

    await user.click(await screen.findByRole('button', { name: 'Sign in to HiveCloud' }))
    await user.click(screen.getByRole('checkbox', { name: 'Trust this device' }))
    await user.click(screen.getByRole('button', { name: 'Approve sign-in' }))

    expect(mocks.signIn).toHaveBeenCalledWith({ sessionProfile: 'TRUSTED' })
  })

  it('disables cloud login when secure storage is unavailable', async () => {
    mocks.getState.mockResolvedValue({
      configured: true,
      status: 'error',
      persistence: 'none',
      errorCode: 'secure_storage_unavailable'
    })
    render(<HiveAccountSettingsPane />)
    expect(await screen.findByText(/secure storage is unavailable/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in to HiveCloud' })).toBeDisabled()
  })
})
