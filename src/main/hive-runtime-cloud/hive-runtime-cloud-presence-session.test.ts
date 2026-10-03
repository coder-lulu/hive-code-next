import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import {
  HiveRuntimeCloudPresenceAccountSession,
  readHiveRuntimeCloudPresenceSession,
  withHiveRuntimeCloudPresenceSession
} from './hive-runtime-cloud-presence-session'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-http-client'

const now = Date.parse('2026-10-04T00:00:00.000Z')
const claims = {
  sub: '123e4567-e89b-42d3-a456-426614174000',
  session_id: '223e4567-e89b-42d3-a456-426614174000',
  authority_id: 'hive-primary',
  exp: now / 1_000 + 1
}
const token = (payload: unknown) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.test-signature`
const authorization: HiveRuntimeCloudAuthorization = {
  accessToken: token(claims),
  accountId: claims.sub,
  authorityId: claims.authority_id,
  sessionGeneration: 1,
  sessionExpiresAt: now + 10_000
}
afterEach(() => vi.useRealTimers())

describe('Runtime presence account session', () => {
  it.each([
    null,
    {},
    { ...claims, session_id: 'invalid' },
    { ...claims, sub: claims.session_id },
    { ...claims, authority_id: 'other-cloud' },
    { ...claims, exp: now / 1_000 },
    { ...claims, exp: '9999999999' },
    { ...claims, exp: Number.MAX_SAFE_INTEGER }
  ])('rejects missing, mismatched or expired session fields: %j', (payload) => {
    expect(
      readHiveRuntimeCloudPresenceSession({ ...authorization, accessToken: token(payload) }, now)
    ).toBeNull()
  })

  it('never treats raw or oversized credentials as presence authority', () => {
    for (const accessToken of ['opaque-token', 'a'.repeat(16_385), 'a.!!!.b']) {
      expect(readHiveRuntimeCloudPresenceSession({ ...authorization, accessToken }, now)).toBeNull()
    }
  })

  it('expires at the access token deadline and reschedules a refreshed token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const expired = vi.fn()
    const session = new HiveRuntimeCloudPresenceAccountSession(Date.now, expired)
    expect(session.update(authorization)).toBe(true)
    await vi.advanceTimersByTimeAsync(999)
    expect(session.current()?.cloudSessionId).toBe(claims.session_id)
    expect(
      session.update({
        ...authorization,
        sessionGeneration: authorization.sessionGeneration + 1,
        accessToken: token({ ...claims, exp: now / 1_000 + 3 })
      })
    ).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(expired).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(session.current()).toBeNull()
    expect(expired).toHaveBeenCalledOnce()
  })

  it('denies authority if the clock advances before the expiry timer runs', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const expired = vi.fn()
    const session = new HiveRuntimeCloudPresenceAccountSession(Date.now, expired)
    session.update(authorization)
    vi.setSystemTime(now + 1_000)
    expect(session.current()).toBeNull()
    expect(expired).toHaveBeenCalledOnce()
    vi.setSystemTime(now)
    expect(session.current()).toBeNull()
    session.clear()
  })

  it('retries an old-token 401 once with a refreshed token for the same session', async () => {
    const initial = readHiveRuntimeCloudPresenceSession(authorization, now)
    if (!initial) {
      throw new Error('test_session_unavailable')
    }
    let current = initial
    const operation = vi.fn(async (sent: typeof initial) => {
      if (sent.accessToken === initial.accessToken) {
        current = { ...initial, accessToken: 'refreshed-token', sessionGeneration: 2 }
        throw new HiveRuntimeCloudRequestError(401, null)
      }
      return 'accepted'
    })
    await expect(
      withHiveRuntimeCloudPresenceSession(initial, () => current, vi.fn(), operation)
    ).resolves.toBe('accepted')
    expect(operation).toHaveBeenCalledTimes(2)
    expect(operation.mock.calls[1][0].cloudSessionId).toBe(initial.cloudSessionId)
  })

  it.each([401, 403])('does not retry status %s with an unchanged token', async (status) => {
    const current = readHiveRuntimeCloudPresenceSession(authorization, now)
    if (!current) {
      throw new Error('test_session_unavailable')
    }
    const operation = vi.fn().mockRejectedValue(new HiveRuntimeCloudRequestError(status, null))
    await expect(
      withHiveRuntimeCloudPresenceSession(current, () => current, vi.fn(), operation)
    ).rejects.toMatchObject({ status })
    expect(operation).toHaveBeenCalledOnce()
  })

  it.each([
    [401, 2],
    [403, 1]
  ])('bounds retries for status %s even when the token changes', async (status, calls) => {
    const initial = readHiveRuntimeCloudPresenceSession(authorization, now)
    if (!initial) {
      throw new Error('test_session_unavailable')
    }
    let current = initial
    const failure = new HiveRuntimeCloudRequestError(status, null)
    const operation = vi.fn(async () => {
      current = { ...current, accessToken: `${current.accessToken}-refreshed` }
      throw failure
    })
    await expect(
      withHiveRuntimeCloudPresenceSession(initial, () => current, vi.fn(), operation)
    ).rejects.toBe(failure)
    expect(operation).toHaveBeenCalledTimes(calls)
  })

  it('does not retry across logout or a different login session', async () => {
    const initial = readHiveRuntimeCloudPresenceSession(authorization, now)
    if (!initial) {
      throw new Error('test_session_unavailable')
    }
    for (const next of [
      null,
      { ...initial, cloudSessionId: claims.sub, accessToken: 'another-login' }
    ]) {
      let current: typeof initial | null = initial
      const operation = vi.fn(async () => {
        current = next
        throw new HiveRuntimeCloudRequestError(401, null)
      })
      await expect(
        withHiveRuntimeCloudPresenceSession(initial, () => current, vi.fn(), operation)
      ).rejects.toThrow('runtime_presence_session_changed')
      expect(operation).toHaveBeenCalledOnce()
    }
  })
})
