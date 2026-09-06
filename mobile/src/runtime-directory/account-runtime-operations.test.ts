import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import { HiveAccountRelayHandshake } from '../../../src/shared/hive-account-relay-channel-handshake'
import { mobileRuntimeRandomBytes } from '../transport/runtime-random'

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
  getRandomBytes: (length: number) => new Uint8Array(length).fill(7),
  randomUUID: () => '55555555-5555-4555-8555-555555555555'
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
const managedSessionId = '11111111-1111-4111-8111-111111111111'

function runtimeSession(id = managedSessionId) {
  return {
    managedSessionId: id,
    backendAuthorityId: 'authority',
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

function revocation() {
  return {
    protocolVersion: 'account-runtime-session-revoke/v2',
    operationId: '55555555-5555-4555-8555-555555555555',
    managedSessionId,
    status: 'REVOKE_PENDING',
    resourceVersion: 3,
    controlVersion: 4
  }
}

describe('account Runtime cloud operations', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    vi.clearAllMocks()
    api.randomToken.mockReturnValueOnce('ticket-secret').mockReturnValue('idempotency-key')
  })

  it('requests current MOBILE material without sending the ticket secret', async () => {
    api.request.mockResolvedValue({
      protocolVersion: 2,
      intentId: managedSessionId,
      ticketId: runtimeRecordId,
      expiresAt: Date.now() + 30_000,
      cellUrl: 'https://relay.hive.test',
      cellId: 'cell-1',
      cellIncarnationId: managedSessionId,
      assignmentId: managedSessionId,
      assignmentEpoch: 1,
      relayHostId: 'AbCdEf0123_-xyZ9',
      clientAdmissionToken: `header.payload.${'a'.repeat(86)}`,
      runtimePublicKeyB64: api.encodeBase64Url(
        nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(3)).publicKey
      ),
      e2eeFraming: 'hive-relay-e2ee/v2'
    })
    // Hermes has no browser crypto API: both material and nonce must use Expo's native entropy.
    vi.stubGlobal('crypto', undefined)
    const material = await createAccountRuntimeConnectionIntent(session, runtimeRecordId, 4)
    const handshake = new HiveAccountRelayHandshake(material, [], mobileRuntimeRandomBytes)
    expect(handshake.session.hello.clientNonceB64).toBe(
      btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
    )
    expect(material.clientKind).toBe('MOBILE')
    const [path, body, options] = api.request.mock.calls[0]!
    expect(path).toBe(`/hive/v1/runtimes/${runtimeRecordId}/connection-intents`)
    expect(body).toMatchObject({
      protocolVersion: 2,
      clientKind: 'MOBILE',
      expectedResourceVersion: 4
    })
    expect(body.ticketSecret).toBeUndefined()
    expect(body.ticketSecretSha256).toHaveLength(43)
    expect(options.headers.Authorization).toBe('Bearer account-token')
  })

  it('rejects malformed and cancelled connection requests before sending credentials', async () => {
    await expect(createAccountRuntimeConnectionIntent(session, '../other', 4)).rejects.toThrow()
    const controller = new AbortController()
    controller.abort()
    await expect(
      createAccountRuntimeConnectionIntent(session, runtimeRecordId, 4, controller.signal)
    ).rejects.toThrow()
    expect(api.request).not.toHaveBeenCalled()
  })

  it('lists and revokes MOBILE sessions through the unified endpoints', async () => {
    const runtimeSessionValue = runtimeSession()
    api.requestWithMetadata.mockResolvedValue({
      value: { items: [runtimeSessionValue], nextCursor: null },
      headers: new Headers()
    })
    api.request.mockResolvedValue(revocation())

    const {
      items: [listed]
    } = await loadRuntimeSessions(session)
    expect(listed).toMatchObject({
      managedSessionId: '11111111-1111-4111-8111-111111111111',
      clientKind: 'MOBILE'
    })
    await expect(revokeRuntimeSession(session, listed!)).resolves.toMatchObject({
      status: 'REVOKE_PENDING'
    })
    expect(api.request).toHaveBeenLastCalledWith(
      '/hive/v1/runtime-sessions/11111111-1111-4111-8111-111111111111/revoke',
      {
        protocolVersion: 'account-runtime-session-revoke/v2',
        expectedResourceVersion: 2,
        operationId: '55555555-5555-4555-8555-555555555555'
      },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer account-token' })
      })
    )
  })

  it('fetches only one bounded page and preserves its cursor', async () => {
    api.requestWithMetadata.mockResolvedValue({
      value: { items: [], nextCursor: 'next-page' },
      headers: new Headers()
    })
    await expect(loadRuntimeSessions(session)).resolves.toEqual({
      items: [],
      nextCursor: 'next-page'
    })
    expect(api.requestWithMetadata).toHaveBeenCalledExactlyOnceWith(
      '/hive/v1/runtime-sessions?limit=25',
      undefined,
      expect.any(Object)
    )
    await loadRuntimeSessions(session, 'page-two')
    expect(api.requestWithMetadata).toHaveBeenLastCalledWith(
      '/hive/v1/runtime-sessions?limit=25&cursor=page-two',
      undefined,
      expect.any(Object)
    )
  })

  it('rejects oversized pages, duplicate ids and invalid cursors', async () => {
    api.requestWithMetadata.mockResolvedValue({
      value: { items: Array(26).fill(runtimeSession()), nextCursor: null },
      headers: new Headers()
    })
    await expect(loadRuntimeSessions(session)).rejects.toThrow()
    api.requestWithMetadata.mockResolvedValue({
      value: { items: [runtimeSession(), runtimeSession()], nextCursor: null },
      headers: new Headers()
    })
    await expect(loadRuntimeSessions(session)).rejects.toThrow('runtime_session_response_duplicate')
    api.requestWithMetadata.mockClear()
    await expect(loadRuntimeSessions(session, 'bad cursor')).rejects.toThrow()
    expect(api.requestWithMetadata).not.toHaveBeenCalled()
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
    api.request.mockResolvedValue({
      ...revocation(),
      managedSessionId: '44444444-4444-4444-8444-444444444444'
    })

    await expect(revokeRuntimeSession(session, target)).rejects.toThrow(
      'runtime_session_revoke_target_mismatch'
    )
  })

  it('rejects a malformed revoke target before sending an account request', async () => {
    await expect(
      revokeRuntimeSession(session, {
        managedSessionId: '../other-session',
        resourceVersion: 1
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
