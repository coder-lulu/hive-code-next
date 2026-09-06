// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))

import { HiveRuntimeSessionsSettings } from './HiveRuntimeSessionsSettings'

const currentDevice = {
  label: 'workstation',
  platform: 'Windows 11',
  profile: 'Trusted',
  authorizationExpiresAt: Date.parse('2026-11-30T03:26:00.000Z')
}

const session = {
  managedSessionId: '11111111-1111-4111-8111-111111111111',
  runtimeRecordId: '22222222-2222-4222-8222-222222222222',
  runtimeInstanceId: '33333333-3333-4333-8333-333333333333',
  runtimeSessionId: '44444444-4444-4444-8444-444444444444',
  clientKind: 'MOBILE' as const,
  clientLabel: 'Ada phone',
  status: 'ACTIVE' as const,
  resourceVersion: 2,
  controlVersion: 3,
  createdAt: Date.parse('2026-08-31T00:00:00.000Z'),
  expiresAt: Date.parse('2026-08-31T01:00:00.000Z'),
  revokeRequestedAt: null,
  revokeAcknowledgedAt: null
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveRuntimeCloud: { listSessions: mocks.listSessions, revokeSession: mocks.revokeSession }
    }
  })
  mocks.listSessions.mockResolvedValue([session])
  mocks.revokeSession.mockResolvedValue({
    managedSessionId: session.managedSessionId,
    status: 'REVOKE_PENDING',
    resourceVersion: 3,
    controlVersion: 4
  })
})

afterEach(cleanup)

describe('HiveRuntimeSessionsSettings', () => {
  it('lists all client kinds and explicitly confirms a forced revoke', async () => {
    const user = userEvent.setup()
    render(
      <HiveRuntimeSessionsSettings
        currentDevice={currentDevice}
        activeTab="runtime"
        onActiveTabChange={vi.fn()}
        onOpenConnectionHelp={vi.fn()}
      />
    )

    expect(await screen.findByText('Ada phone')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText(/Mobile ·/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'End session Ada phone' }))
    expect(screen.getByText('End this Runtime session?')).toBeInTheDocument()
    expect(screen.getAllByText(/Runtime 22222222/)).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'End session' }))

    await waitFor(() =>
      expect(mocks.revokeSession).toHaveBeenCalledWith({
        managedSessionId: session.managedSessionId,
        expectedResourceVersion: 2
      })
    )
    expect(await screen.findByText('Revocation pending')).toBeInTheDocument()
  })

  it('states that local pairing is unaffected when the cloud list fails', async () => {
    mocks.listSessions.mockRejectedValue(new Error('offline'))
    render(
      <HiveRuntimeSessionsSettings
        currentDevice={currentDevice}
        activeTab="runtime"
        onActiveTabChange={vi.fn()}
        onOpenConnectionHelp={vi.fn()}
      />
    )

    expect(await screen.findByText(/Local pairing is unaffected/)).toBeInTheDocument()
  })
})
