import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())

vi.mock('./mobile-sms-client', () => ({
  isRecord: (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  request
}))

import {
  loadMobileLoginConfiguration,
  parseMobileLoginCapabilities
} from './mobile-login-capabilities'

function capabilities(providers: unknown[] = []) {
  return {
    contractRevision: 'hive-login-capabilities-v1',
    clientId: 'hivecode-mobile',
    defaultMethod: 'phone_sms',
    providers
  }
}

describe('mobile login capabilities', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts only the fixed contract and preserves backend provider order', () => {
    expect(
      parseMobileLoginCapabilities(
        capabilities([
          {
            id: 'qq',
            authorizationPath: '/hive/v1/auth/provider-authorizations/qq'
          },
          {
            id: 'github',
            authorizationPath: '/hive/v1/auth/provider-authorizations/github'
          }
        ])
      )?.providers.map(({ id, accessibilityLabel }) => ({ id, accessibilityLabel }))
    ).toEqual([
      { id: 'qq', accessibilityLabel: '使用 QQ 登录' },
      { id: 'github', accessibilityLabel: '使用 GitHub 登录' }
    ])
  })

  it.each([
    capabilities([
      { id: 'gitlab', authorizationPath: '/hive/v1/auth/provider-authorizations/gitlab' }
    ]),
    capabilities([
      { id: 'qq', authorizationPath: '/hive/v1/auth/provider-authorizations/qq' },
      { id: 'qq', authorizationPath: '/hive/v1/auth/provider-authorizations/qq' }
    ]),
    capabilities([{ id: 'qq', authorizationPath: 'https://evil.example/auth' }]),
    { ...capabilities(), contractRevision: 'future' },
    { ...capabilities(), clientId: 'other-client' },
    { ...capabilities(), defaultMethod: 'password' }
  ])('rejects an invalid or unsupported response', (value) => {
    expect(parseMobileLoginCapabilities(value)).toBeNull()
  })

  it('loads the public capability endpoint with no request body', async () => {
    request.mockResolvedValue(
      capabilities([
        { id: 'wechat', authorizationPath: '/hive/v1/auth/provider-authorizations/wechat' }
      ])
    )

    await expect(loadMobileLoginConfiguration()).resolves.toMatchObject({
      providers: [{ id: 'wechat', enabled: true }]
    })
    expect(request).toHaveBeenCalledWith(
      '/hive/v1/meta/login-capabilities?clientId=hivecode-mobile',
      undefined,
      { method: 'GET' }
    )
  })

  it.each([
    new Error('network unavailable'),
    Object.assign(new Error('not found'), { status: 404 })
  ])('fails closed to phone-only when capability loading fails', async (failure) => {
    request.mockRejectedValue(failure)
    await expect(loadMobileLoginConfiguration()).resolves.toEqual({
      registrationEnabled: false,
      providers: []
    })
  })

  it('fails closed to phone-only for an invalid successful response', async () => {
    request.mockResolvedValue(capabilities([{ id: 'unknown', authorizationPath: '/unknown' }]))
    await expect(loadMobileLoginConfiguration()).resolves.toEqual({
      registrationEnabled: false,
      providers: []
    })
  })
})
