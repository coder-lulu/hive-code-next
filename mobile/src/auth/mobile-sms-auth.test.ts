import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}))

const crypto = vi.hoisted(() => ({
  getRandomBytes: vi.fn((length: number) => new Uint8Array(length).fill(7)),
  randomUUID: vi.fn(() => 'device-uuid')
}))

vi.mock('expo-secure-store', () => secureStore)
vi.mock('expo-crypto', () => crypto)
vi.mock('../generated/product-config', () => ({
  hivecodeProductConfig: { endpoints: { cloud: 'https://cloud.example.test/' } }
}))

import {
  loginWithMobileSms,
  requestMobileSms,
  refreshMobileSession,
  revokeMobileSession,
  invalidateMobileSessionRefreshes
} from './mobile-sms-auth'

function response(data: unknown, status = 200) {
  return {
    json: async () => data,
    ok: status >= 200 && status < 300,
    status
  }
}

const challenge = { challengeId: 'challenge-1', expiresInSeconds: 300, resendAfterSeconds: 60 }
const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: '2030-01-01T00:00:00Z',
  sessionExpiresAt: '2030-04-01T00:00:00Z',
  sessionProfile: 'TRUSTED',
  account: { accountId: '7f9c8c7f-9a8b-4f3c-8a33-2a6750e6a111', displayName: '用户5678' },
  authorityId: 'https://identity.hivekernel.com/realms/hive|subject-1'
}

describe('mobile SMS authentication client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    secureStore.deleteItemAsync.mockResolvedValue(undefined)
    // Return null for key material so each test exercises secure generation.
    secureStore.getItemAsync.mockResolvedValue(null)
    secureStore.setItemAsync.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('registers a device, then requests an in-app SMS challenge', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            expiresAt: '2030-01-01T00:05:00Z',
            contractRevision: 'stage2a-device-authorization-v2'
          },
          201
        )
      )
      .mockResolvedValueOnce(response(challenge))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestMobileSms('+8613812345678', true)).resolves.toEqual(challenge)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [deviceUrl, deviceOptions] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(deviceUrl).toBe('https://cloud.example.test/hive/v1/auth/device-authorizations')
    expect(JSON.parse(String(deviceOptions.body))).toMatchObject({
      clientId: 'hivecode-mobile',
      deviceLabel: 'HiveCode Mobile',
      sessionProfile: 'TRUSTED'
    })
    const [smsUrl, smsOptions] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(smsUrl).toBe('https://cloud.example.test/hive/v1/auth/sms-challenges')
    expect(JSON.parse(String(smsOptions.body))).toMatchObject({
      clientId: 'hivecode-mobile',
      phoneNumber: '+8613812345678',
      locale: 'zh-CN',
      termsAccepted: true
    })
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'hivecode.mobile.auth.device-public-key',
      expect.any(String)
    )
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'hivecode.mobile.auth.device-secret-key',
      expect.any(String)
    )
  })

  it('falls back to the Android host gateway when the local test domain is unreachable', async () => {
    vi.stubEnv('EXPO_PUBLIC_ANDROID_EMULATOR', '1')
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to resolve host'))
      .mockResolvedValueOnce(
        response(
          {
            expiresAt: '2030-01-01T00:05:00Z',
            contractRevision: 'stage2a-device-authorization-v2'
          },
          201
        )
      )
      .mockResolvedValueOnce(response(challenge))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestMobileSms('+8613812345678', true)).resolves.toEqual(challenge)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://cloud.example.test/hive/v1/auth/device-authorizations',
      'http://10.0.2.2:8080/hive/v1/auth/device-authorizations',
      'https://cloud.example.test/hive/v1/auth/sms-challenges'
    ])
  })

  it('verifies SMS, obtains a headless authorization code, and exchanges camelCase Hive tokens', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            expiresAt: '2030-01-01T00:05:00Z',
            contractRevision: 'stage2a-device-authorization-v2'
          },
          201
        )
      )
      .mockResolvedValueOnce(response(challenge))
      .mockResolvedValueOnce(response({ verified: true }))
      .mockResolvedValueOnce(response({ authorizationCode: 'oidc-code' }))
      .mockResolvedValueOnce(response(session))
    vi.stubGlobal('fetch', fetchMock)

    await requestMobileSms('+8613812345678', true)
    await expect(
      loginWithMobileSms('+8613812345678', '123456', challenge.challengeId, true)
    ).resolves.toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      sessionProfile: 'TRUSTED'
    })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://cloud.example.test/hive/v1/auth/device-authorizations',
      'https://cloud.example.test/hive/v1/auth/sms-challenges',
      'https://cloud.example.test/hive/v1/auth/sms-challenges/challenge-1/verify',
      'https://cloud.example.test/hive/v1/auth/sms-authorizations',
      'https://cloud.example.test/hive/v1/auth/session-exchange'
    ])
    expect(
      JSON.parse(String((fetchMock.mock.calls[4] as [string, RequestInit])[1].body))
    ).toMatchObject({
      authorizationCode: 'oidc-code',
      redirectUri: 'hivecode://auth/callback',
      clientId: 'hivecode-mobile',
      nonce: expect.any(String),
      codeVerifier: expect.any(String)
    })
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'hivecode.mobile.auth.session',
      expect.stringContaining('access-token')
    )
    expect(secureStore.setItemAsync).not.toHaveBeenCalledWith(
      'hivecode.mobile.auth.access-token',
      expect.anything()
    )
    expect(secureStore.setItemAsync).not.toHaveBeenCalledWith(
      'hivecode.mobile.auth.refresh-token',
      expect.anything()
    )
  })

  it('rejects malformed Hive session responses before storing credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            expiresAt: '2030-01-01T00:05:00Z',
            contractRevision: 'stage2a-device-authorization-v2'
          },
          201
        )
      )
      .mockResolvedValueOnce(response(challenge))
      .mockResolvedValueOnce(response({ verified: true }))
      .mockResolvedValueOnce(response({ authorizationCode: 'oidc-code' }))
      .mockResolvedValueOnce(response({ accessToken: 'access-token' }))
    vi.stubGlobal('fetch', fetchMock)

    await requestMobileSms('+8613812345678', true)
    await expect(
      loginWithMobileSms('+8613812345678', '123456', challenge.challengeId, true)
    ).rejects.toThrow('登录服务返回了无效会话')
    expect(secureStore.setItemAsync).not.toHaveBeenCalledWith(
      'hivecode.mobile.auth.access-token',
      expect.anything()
    )
  })

  it('keeps an issued flow after an invalid code so the user can retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            expiresAt: '2030-01-01T00:05:00Z',
            contractRevision: 'stage2a-device-authorization-v2'
          },
          201
        )
      )
      .mockResolvedValueOnce(response(challenge))
      .mockResolvedValueOnce(response({ category: 'hive.sms_authentication.invalid_code' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    await requestMobileSms('+8613812345678', true)
    await expect(
      loginWithMobileSms('+8613812345678', '000000', challenge.challengeId, true)
    ).rejects.toThrow('验证码错误，请重试')

    fetchMock
      .mockResolvedValueOnce(response({ verified: true }))
      .mockResolvedValueOnce(response({ authorizationCode: 'oidc-code' }))
      .mockResolvedValueOnce(response(session))
    await expect(
      loginWithMobileSms('+8613812345678', '123456', challenge.challengeId, true)
    ).resolves.toMatchObject({ accessToken: 'access-token' })
  })

  it('requires the terms gate before requesting a provider challenge', async () => {
    await expect(requestMobileSms('+8613812345678', false)).rejects.toThrow('请先同意协议')
  })

  it('discards a failed authorization code and obtains a fresh one on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            expiresAt: '2030-01-01T00:05:00Z',
            contractRevision: 'stage2a-device-authorization-v2'
          },
          201
        )
      )
      .mockResolvedValueOnce(response(challenge))
      .mockResolvedValueOnce(response({ verified: true }))
      .mockResolvedValueOnce(response({ authorizationCode: 'oidc-code-1' }))
      .mockResolvedValueOnce(response({ code: 'session_exchange_service_unavailable' }, 503))
      .mockResolvedValueOnce(response({ authorizationCode: 'oidc-code-2' }))
      .mockResolvedValueOnce(response(session))
    vi.stubGlobal('fetch', fetchMock)

    await requestMobileSms('+8613812345678', true)
    await expect(
      loginWithMobileSms('+8613812345678', '123456', challenge.challengeId, true)
    ).rejects.toThrow('登录服务暂时不可用，请稍后再试')
    await expect(
      loginWithMobileSms('+8613812345678', '123456', challenge.challengeId, true)
    ).resolves.toMatchObject({ accessToken: 'access-token' })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://cloud.example.test/hive/v1/auth/device-authorizations',
      'https://cloud.example.test/hive/v1/auth/sms-challenges',
      'https://cloud.example.test/hive/v1/auth/sms-challenges/challenge-1/verify',
      'https://cloud.example.test/hive/v1/auth/sms-authorizations',
      'https://cloud.example.test/hive/v1/auth/session-exchange',
      'https://cloud.example.test/hive/v1/auth/sms-authorizations',
      'https://cloud.example.test/hive/v1/auth/session-exchange'
    ])
  })

  it('coalesces concurrent refresh requests for the same refresh token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(session))
    vi.stubGlobal('fetch', fetchMock)

    const [first, second] = await Promise.all([
      refreshMobileSession('refresh-token'),
      refreshMobileSession('refresh-token')
    ])

    expect(first).toEqual(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cloud.example.test/hive/v1/auth/session-refresh',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('does not persist a refresh result after the session is invalidated', async () => {
    let resolveRefresh: ((value: ReturnType<typeof response>) => void) | undefined
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const refresh = refreshMobileSession('refresh-token')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    invalidateMobileSessionRefreshes()
    resolveRefresh?.(response(session))

    await expect(refresh).rejects.toThrow('mobile_session_refresh_superseded')
    expect(secureStore.setItemAsync).not.toHaveBeenCalled()
  })

  it('revokes a JWT-backed session with its current security version', async () => {
    const payload = btoa(
      JSON.stringify({
        session_id: '3e7af3d4-5e59-4bdf-9fdf-935fed933426',
        session_security_version: 13
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const fetchMock = vi.fn().mockResolvedValue(response({ revoked: true }))
    vi.stubGlobal('fetch', fetchMock)

    await revokeMobileSession({ ...session, accessToken: `header.${payload}.signature` })

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://cloud.example.test/hive/v1/cloud-sessions/3e7af3d4-5e59-4bdf-9fdf-935fed933426/revoke'
    )
    expect(options.headers).toMatchObject({
      Authorization: expect.stringContaining('header.'),
      'Idempotency-Key': expect.any(String)
    })
    expect(JSON.parse(String(options.body))).toEqual({
      expectedSecurityVersion: 13,
      reason: 'owner_sign_out'
    })
  })

  it('revokes the cloud device on trusted-device sign-out', async () => {
    const payload = btoa(
      JSON.stringify({
        session_id: '3e7af3d4-5e59-4bdf-9fdf-935fed933426',
        session_security_version: 13,
        device_id: '2e7af3d4-5e59-4bdf-9fdf-ed9334260001',
        device_security_version: 7
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const fetchMock = vi.fn().mockResolvedValue(response({ revoked: true }))
    vi.stubGlobal('fetch', fetchMock)

    await revokeMobileSession({ ...session, accessToken: `header.${payload}.signature` })

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://cloud.example.test/hive/v1/cloud-account-devices/2e7af3d4-5e59-4bdf-9fdf-ed9334260001/revoke'
    )
    expect(JSON.parse(String(options.body))).toEqual({ expectedSecurityVersion: 7 })
  })
})
