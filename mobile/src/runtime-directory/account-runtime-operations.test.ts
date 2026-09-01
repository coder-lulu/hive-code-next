import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  request: vi.fn(),
  requestWithMetadata: vi.fn(),
  randomToken: vi.fn(),
  encodeBase64Url: (value: Uint8Array) =>
    btoa(String.fromCharCode(...value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, ''),
  isRecord: (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
}))

vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(7)
}))
vi.mock('../auth/mobile-sms-client', () => api)

import type { MobileSession } from '../auth/mobile-sms-auth'
import {
  createAccountRuntimeConnectionIntent,
  loadAllAccountRuntimes,
  loadRuntimePresence,
  loadRuntimeSessions,
  revokeRuntimeSession
} from './account-runtime-directory-client'

const session = { accessToken: 'account-token' } as MobileSession
const runtimeRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const managedWebSessionId = '11111111-1111-4111-8111-111111111111'

function validRuntimePublicKeyUrl(): string {
  const basePoint = new Uint8Array(32)
  basePoint[0] = 9
  return api.encodeBase64Url(basePoint)
}

function runtimeSession(id = managedWebSessionId) {
  return {
    managedWebSessionId: id,
    runtimeRecordId,
    runtimeInstanceId: '22222222-2222-4222-8222-222222222222',
    runtimeSessionId: '33333333-3333-4333-8333-333333333333',
    clientKind: 'MOBILE' as const,
    clientLabel: 'Phone',
    status: 'ACTIVE' as const,
    resourceVersion: 2,
    controlVersion: 3,
    createdAt: '2026-08-31T00:00:00Z',
    expiresAt: '2026-08-31T01:00:00Z',
    revokeRequestedAt: null,
    revokeAcknowledgedAt: null
  }
}

describe('account Runtime cloud operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.randomToken.mockReturnValueOnce('ticket-secret').mockReturnValue('idempotency-key')
  })

  it('uploads only a ticket digest and the ephemeral public key', async () => {
    const controller = new AbortController()
    api.request.mockResolvedValue({
      connectionIntentId: '11111111-1111-4111-8111-111111111111',
      ticketId: '22222222-2222-4222-8222-222222222222',
      runtimeRecordId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      runtimePublicKeyB64: validRuntimePublicKeyUrl(),
      relay: null
    })

    const result = await createAccountRuntimeConnectionIntent(
      session,
      runtimeRecordId,
      4,
      controller.signal
    )
    const body = api.request.mock.calls[0]![1] as Record<string, unknown>
    const options = api.request.mock.calls[0]![2] as RequestInit

    expect(body).toMatchObject({ clientKind: 'MOBILE', expectedResourceVersion: 4 })
    expect(body.ticketSecretSha256).not.toBe('ticket-secret')
    expect(body.clientEphemeralPublicKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(body)).not.toContain('ticket-secret')
    expect(options.signal).toBe(controller.signal)
    expect(result.ticketSecret).toBe('ticket-secret')
    expect(result.runtimePublicKeyB64).toBe(
      `${validRuntimePublicKeyUrl().replace(/-/g, '+').replace(/_/g, '/')}=`
    )
  })

  it('rejects a low-order X25519 Runtime public key returned by Cloud', async () => {
    api.request.mockResolvedValue({
      connectionIntentId: '11111111-1111-4111-8111-111111111111',
      ticketId: '22222222-2222-4222-8222-222222222222',
      runtimeRecordId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      runtimePublicKeyB64: api.encodeBase64Url(new Uint8Array(32)),
      relay: null
    })

    await expect(createAccountRuntimeConnectionIntent(session, runtimeRecordId, 4)).rejects.toThrow(
      'runtime_connection_intent_public_key_invalid'
    )
  })

  it('lists and revokes MOBILE sessions through the unified endpoints', async () => {
    const runtimeSessionValue = runtimeSession()
    api.requestWithMetadata.mockResolvedValue({
      value: { items: [runtimeSessionValue] },
      headers: new Headers()
    })
    api.request.mockResolvedValue({ ...runtimeSessionValue, status: 'REVOKE_PENDING' })

    const [listed] = await loadRuntimeSessions(session)
    expect(listed).toMatchObject({
      managedWebSessionId: '11111111-1111-4111-8111-111111111111',
      clientKind: 'MOBILE'
    })
    await expect(revokeRuntimeSession(session, listed!)).resolves.toMatchObject({
      status: 'REVOKE_PENDING'
    })
    expect(api.request).toHaveBeenLastCalledWith(
      '/hive/v1/runtime-sessions/11111111-1111-4111-8111-111111111111/revoke',
      {
        protocolVersion: 'web-session-revoke/v1',
        expectedControlVersion: 3,
        reasonCode: 'USER_REQUESTED'
      },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer account-token' })
      })
    )
  })

  it('bounds session pagination even when every cursor is unique', async () => {
    api.requestWithMetadata.mockImplementation(async () => ({
      value: {
        items: [],
        nextCursor: `cursor-${api.requestWithMetadata.mock.calls.length}`
      },
      headers: new Headers()
    }))

    await expect(loadRuntimeSessions(session)).rejects.toThrow(
      'runtime_session_page_limit_exceeded'
    )
    expect(api.requestWithMetadata).toHaveBeenCalledTimes(100)
  })

  it('rejects an oversized directory cursor before issuing another request', async () => {
    api.requestWithMetadata.mockResolvedValue({
      value: { items: [] },
      headers: new Headers({ 'X-Hive-Next-Cursor': 'x'.repeat(257) })
    })

    await expect(loadAllAccountRuntimes(session)).rejects.toThrow(
      'runtime_directory_cursor_invalid'
    )
    expect(api.requestWithMetadata).toHaveBeenCalledOnce()
  })

  it('rejects a revoke response for a different managed session id', async () => {
    const target = runtimeSession()
    api.request.mockResolvedValue(runtimeSession('44444444-4444-4444-8444-444444444444'))

    await expect(revokeRuntimeSession(session, target)).rejects.toThrow(
      'runtime_session_revoke_target_mismatch'
    )
  })

  it('rejects a malformed revoke target before sending an account request', async () => {
    await expect(
      revokeRuntimeSession(session, {
        managedWebSessionId: '../other-session',
        controlVersion: 1
      })
    ).rejects.toThrow()
    expect(api.request).not.toHaveBeenCalled()
  })

  it('batches large presence refreshes without dropping Runtime ids', async () => {
    const runtimeIds = Array.from(
      { length: 101 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    )
    api.request.mockResolvedValue({ items: [] })

    await expect(loadRuntimePresence(session, runtimeIds)).resolves.toEqual([])
    expect(api.request).toHaveBeenCalledTimes(2)
    expect(api.request.mock.calls[0]![0]).toContain('ids=')
    expect(api.request.mock.calls[1]![0]).toContain(encodeURIComponent(runtimeIds[100]!))
  })
})
