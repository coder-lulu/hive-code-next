import { beforeEach, describe, expect, it, vi } from 'vitest'

const secureValues = vi.hoisted(() => new Map<string, string>())
const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(async (key: string) => {
    secureValues.delete(key)
  }),
  getItemAsync: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureValues.set(key, value)
  })
}))
const linking = vi.hoisted(() => ({ openURL: vi.fn(async () => undefined) }))
const auth = vi.hoisted(() => ({
  parseSession: vi.fn((value: unknown) => value),
  saveMobileSession: vi.fn(async () => undefined)
}))
const deviceAuthorization = vi.hoisted(() => ({
  registerMobileDeviceAuthorization: vi.fn(async () => undefined)
}))
const client = vi.hoisted(() => {
  class MobileApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly category: string | undefined,
      readonly retryable: boolean
    ) {
      super(message)
    }
  }
  return {
    MobileApiError,
    randomToken: vi.fn(),
    request: vi.fn()
  }
})

vi.mock('expo-secure-store', () => secureStore)
vi.mock('expo-linking', () => linking)
vi.mock('./mobile-sms-auth', () => auth)
vi.mock('./mobile-device-authorization', () => deviceAuthorization)
vi.mock('./mobile-sms-client', () => ({
  MobileApiError: client.MobileApiError,
  encodeBase64Url: () => 'pkce-challenge',
  isRecord: (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  mobileApiUrl: (path: string) => `https://cloud.example.test${path}`,
  randomToken: client.randomToken,
  request: client.request
}))

import {
  beginMobileProviderLogin,
  completeMobileProviderLogin,
  isMobileProviderCallbackUrl
} from './mobile-provider-auth'
import type { MobileLoginProvider } from './mobile-login-presentation'

const provider: MobileLoginProvider = {
  id: 'github',
  enabled: true,
  accessibilityLabel: '使用 GitHub 登录',
  authorizationPath: '/hive/v1/auth/provider-authorizations/github'
}
const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token'
}

describe('mobile provider authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    secureValues.clear()
    client.randomToken
      .mockReturnValueOnce('nonce-value')
      .mockReturnValueOnce('state-value')
      .mockReturnValueOnce('verifier-value')
    client.request.mockResolvedValue(session)
  })

  it('registers the device, persists the pending flow, and opens the backend PKCE URL', async () => {
    await beginMobileProviderLogin(provider, true)

    expect(deviceAuthorization.registerMobileDeviceAuthorization).toHaveBeenCalledWith(
      'nonce-value'
    )
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'hivecode.mobile.auth.pending-provider-flow',
      expect.stringContaining('verifier-value')
    )
    const opened = new URL(linking.openURL.mock.calls[0]![0] as string)
    expect(`${opened.origin}${opened.pathname}`).toBe(
      'https://cloud.example.test/hive/v1/auth/provider-authorizations/github'
    )
    expect(Object.fromEntries(opened.searchParams)).toMatchObject({
      client_id: 'hivecode-mobile',
      redirect_uri: 'hivecode://auth/callback',
      response_type: 'code',
      scope: 'openid profile hive.session.exchange',
      state: 'state-value',
      nonce: 'nonce-value',
      code_challenge: 'pkce-challenge',
      code_challenge_method: 'S256'
    })
  })

  it('requires agreement and refuses a provider path not issued by capabilities', async () => {
    await expect(beginMobileProviderLogin(provider, false)).rejects.toThrow('请先同意协议')
    await expect(
      beginMobileProviderLogin({ ...provider, authorizationPath: '/unexpected' }, true)
    ).rejects.toThrow('mobile_provider_unavailable')
    expect(linking.openURL).not.toHaveBeenCalled()
  })

  it('recognizes only the exact native callback route', () => {
    expect(isMobileProviderCallbackUrl('hivecode://auth/callback?code=a&state=b')).toBe(true)
    expect(isMobileProviderCallbackUrl('HIVECODE://AUTH/callback?code=a&state=b')).toBe(true)
    expect(isMobileProviderCallbackUrl('hivecode://auth/callback-extra?code=a&state=b')).toBe(false)
    expect(isMobileProviderCallbackUrl('hivecode://user@auth/callback?code=a&state=b')).toBe(false)
    expect(isMobileProviderCallbackUrl('https://auth/callback?code=a&state=b')).toBe(false)
  })

  it('validates state, exchanges once, saves, and returns the unified session', async () => {
    await beginMobileProviderLogin(provider, true)

    await expect(
      completeMobileProviderLogin(
        'hivecode://auth/callback?code=authorization-code&state=state-value'
      )
    ).resolves.toBe(session)
    expect(client.request).toHaveBeenCalledWith('/hive/v1/auth/session-exchange', {
      authorizationCode: 'authorization-code',
      codeVerifier: 'verifier-value',
      redirectUri: 'hivecode://auth/callback',
      clientId: 'hivecode-mobile',
      nonce: 'nonce-value'
    })
    expect(auth.saveMobileSession).toHaveBeenCalledWith(session)
    expect(secureValues.has('hivecode.mobile.auth.pending-provider-flow')).toBe(false)

    await expect(
      completeMobileProviderLogin(
        'hivecode://auth/callback?code=authorization-code&state=state-value'
      )
    ).rejects.toThrow('mobile_provider_callback_expired')
    expect(client.request).toHaveBeenCalledTimes(1)
  })

  it('does not consume or exchange a pending flow when state mismatches', async () => {
    await beginMobileProviderLogin(provider, true)
    await expect(
      completeMobileProviderLogin('hivecode://auth/callback?code=authorization-code&state=attacker')
    ).rejects.toThrow('mobile_provider_callback_state_mismatch')
    expect(client.request).not.toHaveBeenCalled()
    expect(secureValues.has('hivecode.mobile.auth.pending-provider-flow')).toBe(true)
  })

  it('retains PKCE state after a retryable exchange failure and allows the callback to retry', async () => {
    await beginMobileProviderLogin(provider, true)
    client.request.mockRejectedValueOnce(
      new client.MobileApiError('temporarily unavailable', 503, undefined, true)
    )
    const callback = 'hivecode://auth/callback?code=authorization-code&state=state-value'

    await expect(completeMobileProviderLogin(callback)).rejects.toThrow('temporarily unavailable')
    expect(secureValues.has('hivecode.mobile.auth.pending-provider-flow')).toBe(true)

    await expect(completeMobileProviderLogin(callback)).resolves.toBe(session)
    expect(client.request).toHaveBeenCalledTimes(2)
    expect(secureValues.has('hivecode.mobile.auth.pending-provider-flow')).toBe(false)
  })

  it('consumes a matching OAuth error without exchanging a session', async () => {
    await beginMobileProviderLogin(provider, true)
    await expect(
      completeMobileProviderLogin('hivecode://auth/callback?error=access_denied&state=state-value')
    ).rejects.toThrow('mobile_provider_authorization_cancelled')
    expect(client.request).not.toHaveBeenCalled()
    expect(secureValues.has('hivecode.mobile.auth.pending-provider-flow')).toBe(false)
  })

  it('rejects duplicate callback credentials before reading pending state', async () => {
    await beginMobileProviderLogin(provider, true)
    await expect(
      completeMobileProviderLogin(
        'hivecode://auth/callback?code=first&code=second&state=state-value'
      )
    ).rejects.toThrow('mobile_provider_callback_invalid')
    expect(client.request).not.toHaveBeenCalled()
  })

  it('expires durable pending state before exchanging a callback', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    await beginMobileProviderLogin(provider, true)
    now.mockReturnValue(5 * 60 * 1000 + 1_001)

    await expect(
      completeMobileProviderLogin(
        'hivecode://auth/callback?code=authorization-code&state=state-value'
      )
    ).rejects.toThrow('mobile_provider_callback_expired')
    expect(client.request).not.toHaveBeenCalled()
    expect(secureValues.has('hivecode.mobile.auth.pending-provider-flow')).toBe(false)
    now.mockRestore()
  })
})
