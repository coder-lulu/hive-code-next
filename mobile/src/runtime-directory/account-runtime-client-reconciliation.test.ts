import { describe, expect, it, vi } from 'vitest'
import type { AccountRuntimeClientRegistration } from './account-runtime-client-registry'
import {
  invalidateAccountRuntimeClients,
  reconcileAccountRuntimeClients
} from './account-runtime-client-reconciliation'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'

const entry = {
  runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  status: 'CLAIMED',
  runtimeVersion: '1.0.0',
  runtimeProtocolVersion: 3,
  capabilities: [],
  resourceVersion: 4,
  createdAt: '2026-08-31T00:00:00Z',
  claimedAt: '2026-08-31T00:00:00Z',
  updatedAt: '2026-08-31T00:00:00Z',
  lastHeartbeatAt: '2026-08-31T00:00:30Z',
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: null,
  freeDiskBytes: null,
  clientAuthMode: 'IDENTITY_PROOF',
  credentialState: 'ACTIVE',
  connectionCapabilities: ['relay']
} satisfies AccountRuntimeDirectoryEntry

const accountOnly = {
  hostId: entry.runtimeRecordId,
  runtimeRecordId: entry.runtimeRecordId,
  resourceVersion: entry.resourceVersion,
  accessMode: 'account-only'
} satisfies AccountRuntimeClientRegistration

const localFallback = {
  ...accountOnly,
  hostId: 'local-host',
  accessMode: 'local-fallback'
} satisfies AccountRuntimeClientRegistration

describe('account Runtime client reconciliation', () => {
  it('disconnects account-only clients but refreshes local fallbacks on account removal', () => {
    const disconnect = vi.fn()
    const refresh = vi.fn()

    reconcileAccountRuntimeClients([], [accountOnly, localFallback], disconnect, refresh)

    expect(disconnect).toHaveBeenCalledWith(accountOnly.hostId)
    expect(refresh).toHaveBeenCalledWith(localFallback.hostId)
  })

  it('refreshes a live client when its Runtime resource version changes', () => {
    const disconnect = vi.fn()
    const refresh = vi.fn()

    reconcileAccountRuntimeClients(
      [{ ...entry, resourceVersion: entry.resourceVersion + 1 }],
      [accountOnly],
      disconnect,
      refresh
    )

    expect(refresh).toHaveBeenCalledWith(accountOnly.hostId)
    expect(disconnect).not.toHaveBeenCalled()
  })

  it('invalidates clients whose account credential is expired', () => {
    const disconnect = vi.fn()
    const refresh = vi.fn()

    reconcileAccountRuntimeClients(
      [{ ...entry, credentialState: 'EXPIRED' }],
      [accountOnly],
      disconnect,
      refresh
    )

    expect(disconnect).toHaveBeenCalledWith(accountOnly.hostId)
  })

  it('uses the same access-mode isolation when an account switches or signs out', () => {
    const disconnect = vi.fn()
    const refresh = vi.fn()

    invalidateAccountRuntimeClients([accountOnly, localFallback], disconnect, refresh)

    expect(disconnect).toHaveBeenCalledWith(accountOnly.hostId)
    expect(refresh).toHaveBeenCalledWith(localFallback.hostId)
  })
})
