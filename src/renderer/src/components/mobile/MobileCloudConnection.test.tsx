// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountSettingsContentProps } from '../settings/HiveAccountSettingsContent'
import type { HiveAccountRuntimeDirectoryEntry } from '../../../../shared/hive-runtime-cloud'
import { MobileCloudConnection } from './MobileCloudConnection'
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback,
  getIntlLocale: () => 'en'
}))
const runtime: HiveAccountRuntimeDirectoryEntry = {
  runtimeRecordId: 'runtime-1',
  status: 'CLAIMED',
  runtimeVersion: '1.0.0',
  runtimeProtocolVersion: 3,
  capabilities: [],
  resourceVersion: 1,
  ownershipEpoch: 1,
  cloudDisplayName: null,
  cloudDisplayNameVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  claimedAt: 1,
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: null,
  lastHeartbeatAt: Date.now(),
  observedAt: Date.now(),
  freeDiskBytes: null,
  clientAuthMode: 'IDENTITY_PROOF',
  credentialState: 'ACTIVE',
  connectionCapabilities: ['hive-relay']
}
function props(): HiveAccountSettingsContentProps {
  return {
    state: {
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      account: { accountId: 'account-1', displayName: 'Ada' },
      deviceLabel: 'Workstation'
    },
    directory: {
      status: 'READY',
      accountId: 'account-1',
      sessionGeneration: 1,
      items: [runtime],
      lastSyncedAt: Date.now(),
      errorCode: null
    },
    ownership: {
      stateRevision: 1,
      relation: 'CLAIMED_BY_CURRENT',
      accountId: 'account-1',
      sessionGeneration: 1,
      runtimeRecordId: 'runtime-1',
      ownershipEpoch: 1,
      claimCapabilityAvailable: false,
      presence: 'ONLINE',
      checkedAt: Date.now(),
      errorCode: null
    },
    platformInfo: null,
    busy: null,
    canSignIn: true,
    onSignIn: vi.fn(),
    onRefresh: vi.fn(),
    onClaimRuntime: vi.fn(),
    onOpenRuntimeDetails: vi.fn(),
    onSignOut: vi.fn()
  }
}
afterEach(cleanup)
describe('HiveCloud phone connection readiness', () => {
  it('shows this computer as connectable only after account binding and relay readiness', () => {
    render(<MobileCloudConnection {...props()} />)
    expect(screen.getByText('Ready to connect')).toBeInTheDocument()
    expect(screen.getByText(/select this computer from your account list/)).toBeInTheDocument()
  })
  it.each([
    { connectionCapabilities: ['orca-direct'] },
    { clientAuthMode: 'MTLS' as const },
    { credentialState: 'REVOKED' as const },
    { readiness: 'RECOVERING' as const },
    { presence: 'OFFLINE' as const }
  ])('withholds connectable status when connection material is unusable: %j', (partial) => {
    const input = props()
    input.directory = { ...input.directory, items: [{ ...runtime, ...partial }] }
    render(<MobileCloudConnection {...input} />)
    expect(screen.queryByText('Ready to connect')).not.toBeInTheDocument()
  })
  it.each(['STALE', 'ERROR', 'LOADING'] as const)(
    'withholds connectable status for a %s directory',
    (status) => {
      const input = props()
      input.directory = { ...input.directory, status }
      render(<MobileCloudConnection {...input} />)
      expect(screen.queryByText('Ready to connect')).not.toBeInTheDocument()
    }
  )
  it('does not reuse another account ownership or show claim action from it', () => {
    const input = props()
    input.ownership = { ...input.ownership, accountId: 'account-2', relation: 'UNREGISTERED' }
    render(<MobileCloudConnection {...input} />)
    expect(screen.queryByText('Ready to connect')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Link this computer' })).not.toBeInTheDocument()
  })
  it('withholds connectable status when ownership and directory belong to different sign-in generations', () => {
    const input = props()
    input.ownership = { ...input.ownership, sessionGeneration: 2 }
    render(<MobileCloudConnection {...input} />)
    expect(screen.queryByText('Ready to connect')).not.toBeInTheDocument()
  })
  it('requires renewed account authorization after sign-in expiry', () => {
    const input = props()
    input.state = { ...input.state!, errorCode: 'session_expired' }
    render(<MobileCloudConnection {...input} />)
    expect(screen.queryByText('Ready to connect')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument()
  })
  it('does not present expired directory evidence as an online computer', () => {
    const input = props()
    input.directory = { ...input.directory, status: 'STALE' }
    render(<MobileCloudConnection {...input} />)
    expect(screen.getByText('Service temporarily unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Cloud access unavailable')).not.toBeInTheDocument()
  })
  it('does not infer a verified session when both generations are missing', () => {
    const input = props()
    input.directory = { ...input.directory, sessionGeneration: null }
    input.ownership = { ...input.ownership, sessionGeneration: null }
    render(<MobileCloudConnection {...input} />)
    expect(screen.queryByText('Ready to connect')).not.toBeInTheDocument()
  })
  it('links an unregistered computer through the existing account action', async () => {
    const input = props()
    input.ownership = { ...input.ownership, relation: 'UNREGISTERED', runtimeRecordId: null }
    render(<MobileCloudConnection {...input} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Link this computer' }))
    expect(input.onClaimRuntime).toHaveBeenCalledTimes(1)
  })
})
