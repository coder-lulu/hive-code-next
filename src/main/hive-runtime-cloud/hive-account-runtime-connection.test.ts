import { describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import { HiveAccountRuntimeDirectoryService } from './hive-account-runtime-directory-service'

const runtimeRecordId = '123e4567-e89b-42d3-a456-426614174000'
const ownerAuthorization: HiveRuntimeCloudAuthorization = {
  accessToken: 'account-access-secret',
  accountId: '223e4567-e89b-42d3-a456-426614174000',
  authorityId: 'authority-from-capabilities',
  sessionExpiresAt: 20_000,
  sessionGeneration: 4
}
const runtime: HiveAccountRuntimeDirectoryEntry = {
  runtimeRecordId,
  status: 'CLAIMED',
  runtimeVersion: '1.5.0',
  runtimeProtocolVersion: 3,
  capabilities: [],
  resourceVersion: 7,
  createdAt: 100,
  updatedAt: 200,
  claimedAt: 120,
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: null,
  lastHeartbeatAt: 190,
  observedAt: 200,
  freeDiskBytes: 1024,
  clientAuthMode: 'IDENTITY_PROOF',
  credentialState: 'ACTIVE',
  connectionCapabilities: ['hive-relay']
}

describe('Hive account Runtime connection material', () => {
  it('keeps the ticket secret client-side and binds an intent to the directory revision', async () => {
    const listOwnedRuntimes = vi.fn().mockResolvedValue({ items: [runtime], nextCursor: null })
    const createConnectionIntent = vi.fn().mockResolvedValue({
      connectionIntentId: 'intent-1',
      ticketId: 'ticket-1',
      runtimeRecordId,
      expiresAt: 15_000,
      runtimePublicKeyB64: 'A'.repeat(43),
      relay: {
        cellUrl: 'https://relay.hivekernel.com',
        relayHostId: 'abcdefghijklmnop',
        assignmentEpoch: 8,
        e2eeFraming: 'hive-e2ee-v1' as const
      }
    })
    const service = new HiveAccountRuntimeDirectoryService(
      { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
      { createClient: () => ({ listOwnedRuntimes, createConnectionIntent }), now: () => 1_000 }
    )
    service.setAuthorization(ownerAuthorization)
    await vi.waitFor(() => expect(service.getState().status).toBe('READY'))

    const material = await service.createConnection(runtimeRecordId, 7)

    const request = createConnectionIntent.mock.calls[0]?.[1]
    expect(request).toMatchObject({
      clientKind: 'DESKTOP',
      expectedResourceVersion: 7,
      ticketSecretSha256: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      clientEphemeralPublicKey: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
    })
    expect(request).not.toHaveProperty('ticketSecret')
    expect(material.ticketSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(material.ticketSecret).not.toBe(request.ticketSecretSha256)
    expect(createConnectionIntent).toHaveBeenCalledWith(
      runtimeRecordId,
      expect.any(Object),
      'account-access-secret',
      expect.any(String),
      undefined
    )
    service.stop()
  })

  it('refuses a stale catalog revision before minting a connection intent', async () => {
    const createConnectionIntent = vi.fn()
    const service = new HiveAccountRuntimeDirectoryService(
      { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
      {
        createClient: () => ({
          listOwnedRuntimes: vi.fn().mockResolvedValue({ items: [runtime], nextCursor: null }),
          createConnectionIntent
        }),
        now: () => 1_000
      }
    )
    service.setAuthorization(ownerAuthorization)
    await vi.waitFor(() => expect(service.getState().status).toBe('READY'))

    await expect(service.createConnection(runtimeRecordId, 6)).rejects.toMatchObject({
      code: 'STALE'
    })
    expect(createConnectionIntent).not.toHaveBeenCalled()
    service.stop()
  })

  it('refuses an ineligible directory entry before minting a connection intent', async () => {
    const createConnectionIntent = vi.fn()
    const service = new HiveAccountRuntimeDirectoryService(
      { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
      {
        createClient: () => ({
          listOwnedRuntimes: vi.fn().mockResolvedValue({
            items: [{ ...runtime, credentialState: 'EXPIRED' }],
            nextCursor: null
          }),
          createConnectionIntent
        }),
        now: () => 1_000
      }
    )
    service.setAuthorization(ownerAuthorization)
    await vi.waitFor(() => expect(service.getState().status).toBe('READY'))

    await expect(service.createConnection(runtimeRecordId, 7)).rejects.toMatchObject({
      code: 'RELAY_UNAVAILABLE'
    })
    expect(createConnectionIntent).not.toHaveBeenCalled()
    service.stop()
  })

  it('rejects an intent response when the directory revision changed in flight', async () => {
    let resolveIntent!: (value: object) => void
    const listOwnedRuntimes = vi
      .fn()
      .mockResolvedValueOnce({ items: [runtime], nextCursor: null })
      .mockResolvedValueOnce({
        items: [{ ...runtime, resourceVersion: 8 }],
        nextCursor: null
      })
    const createConnectionIntent = vi.fn(
      () =>
        new Promise<object>((resolve) => {
          resolveIntent = resolve
        })
    )
    const service = new HiveAccountRuntimeDirectoryService(
      { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
      {
        createClient: () => ({
          listOwnedRuntimes,
          createConnectionIntent: createConnectionIntent as never
        }),
        now: () => 1_000
      }
    )
    service.setAuthorization(ownerAuthorization)
    await vi.waitFor(() => expect(service.getState().status).toBe('READY'))

    const connecting = service.createConnection(runtimeRecordId, 7)
    await service.refresh()
    resolveIntent({
      connectionIntentId: 'intent-1',
      ticketId: 'ticket-1',
      runtimeRecordId,
      expiresAt: 15_000,
      runtimePublicKeyB64: 'A'.repeat(43),
      relay: {
        cellUrl: 'https://relay.hivekernel.com',
        relayHostId: 'abcdefghijklmnop',
        assignmentEpoch: 8,
        e2eeFraming: 'hive-e2ee-v1'
      }
    })

    await expect(connecting).rejects.toMatchObject({ code: 'STALE' })
    service.stop()
  })

  it('rejects an intent response after switching authority with the same account generation', async () => {
    let resolveIntent!: (value: object) => void
    const createConnectionIntent = vi.fn(
      () =>
        new Promise<object>((resolve) => {
          resolveIntent = resolve
        })
    )
    const service = new HiveAccountRuntimeDirectoryService(
      { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
      {
        createClient: () => ({
          listOwnedRuntimes: vi.fn().mockResolvedValue({ items: [runtime], nextCursor: null }),
          createConnectionIntent: createConnectionIntent as never
        }),
        now: () => 1_000
      }
    )
    service.setAuthorization(ownerAuthorization)
    await vi.waitFor(() => expect(service.getState().status).toBe('READY'))

    const connecting = service.createConnection(runtimeRecordId, 7)
    service.setAuthorization({
      ...ownerAuthorization,
      authorityId: 'replacement-authority',
      accessToken: 'replacement-secret'
    })
    await vi.waitFor(() => expect(service.getState().status).toBe('READY'))
    resolveIntent({
      connectionIntentId: 'intent-1',
      ticketId: 'ticket-1',
      runtimeRecordId,
      expiresAt: 15_000,
      runtimePublicKeyB64: 'A'.repeat(43),
      relay: {
        cellUrl: 'https://relay.hivekernel.com',
        relayHostId: 'abcdefghijklmnop',
        assignmentEpoch: 8,
        e2eeFraming: 'hive-e2ee-v1'
      }
    })

    await expect(connecting).rejects.toMatchObject({ code: 'SIGNED_OUT' })
    service.stop()
  })
})
