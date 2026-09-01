import { describe, expect, it, vi } from 'vitest'

const electronNetFetch = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  net: { fetch: electronNetFetch }
}))

import { HiveAccountClient } from './hive-account-client'

const config = {
  apiBaseUrl: 'https://api.hivekernel.com',
  identityIssuer: 'https://identity.hivekernel.com/realms/hive',
  clientId: 'hivecode-desktop',
  scope: 'openid profile email hive.session.exchange'
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('Hive account Native client', () => {
  it('validates account security payloads and security challenge bounds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        accountId: '123e4567-e89b-42d3-a456-426614174000',
        userName: 'm13800138000',
        displayName: 'Ada',
        phoneNumber: null,
        phoneBound: false
      }))
      .mockResolvedValueOnce(jsonResponse({
        challengeId: 'challenge', bindingId: 'binding', expiresInSeconds: 300, resendAfterSeconds: 60
      }))
    const client = new HiveAccountClient(config, fetchMock)
    await expect(client.accountSecurity('access')).resolves.toMatchObject({ displayName: 'Ada' })
    await expect(client.startPhoneBinding('access', '+8613800138000')).resolves.toMatchObject({
      expiresInSeconds: 300
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({
      challengeId: 'challenge', bindingId: 'binding', expiresInSeconds: -1, resendAfterSeconds: 60
    }))
    await expect(client.startPhoneBinding('access', '+8613800138000')).rejects.toThrow(
      'invalid_hive_account_security_challenge'
    )
  })

  it('uses the Electron Chrome network stack by default', async () => {
    electronNetFetch.mockResolvedValueOnce(
      jsonResponse({
        issuer: config.identityIssuer,
        authorization_endpoint:
          'https://identity.hivekernel.com/realms/hive/protocol/openid-connect/auth'
      })
    )

    const client = new HiveAccountClient(config)

    await expect(client.discoverAuthorizationEndpoint()).resolves.toContain(
      '/protocol/openid-connect/auth'
    )
    expect(electronNetFetch).toHaveBeenCalledWith(
      `${config.identityIssuer}/.well-known/openid-configuration`,
      expect.objectContaining({ redirect: 'error', cache: 'no-store' })
    )
  })

  it('accepts only discovery metadata for the configured issuer and origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        issuer: config.identityIssuer,
        authorization_endpoint:
          'https://identity.hivekernel.com/realms/hive/protocol/openid-connect/auth'
      })
    )
    const client = new HiveAccountClient(config, fetchMock)
    await expect(client.discoverAuthorizationEndpoint()).resolves.toBe(
      'https://identity.hivekernel.com/realms/hive/protocol/openid-connect/auth'
    )
    expect(fetchMock).toHaveBeenCalledWith(
      `${config.identityIssuer}/.well-known/openid-configuration`,
      expect.objectContaining({ redirect: 'error', cache: 'no-store' })
    )
  })

  it('loads the ordered login providers from the exact desktop capability contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        contractRevision: 'hive-login-capabilities-v1',
        clientId: 'hivecode-desktop',
        defaultMethod: 'phone_sms',
        providers: [
          {
            id: 'wechat',
            authorizationPath: '/hive/v1/auth/provider-authorizations/wechat'
          },
          {
            id: 'github',
            authorizationPath: '/hive/v1/auth/provider-authorizations/github'
          }
        ]
      })
    )
    const client = new HiveAccountClient(config, fetchMock)

    await expect(client.getLoginCapabilities()).resolves.toMatchObject({
      clientId: 'hivecode-desktop',
      defaultMethod: 'phone_sms',
      providers: [{ id: 'wechat' }, { id: 'github' }]
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.hivekernel.com/hive/v1/meta/login-capabilities?clientId=hivecode-desktop',
      expect.objectContaining({ method: 'GET', redirect: 'error', cache: 'no-store' })
    )
  })

  it.each([
    {
      contractRevision: 'hive-login-capabilities-v1',
      clientId: 'another-client',
      defaultMethod: 'phone_sms',
      providers: []
    },
    {
      contractRevision: 'hive-login-capabilities-v1',
      clientId: 'hivecode-desktop',
      defaultMethod: 'phone_sms',
      providers: [
        { id: 'github', authorizationPath: 'https://attacker.test/authorize' }
      ]
    },
    {
      contractRevision: 'hive-login-capabilities-v1',
      clientId: 'hivecode-desktop',
      defaultMethod: 'phone_sms',
      providers: [
        { id: 'github', authorizationPath: '/hive/v1/auth/provider-authorizations/github' },
        { id: 'github', authorizationPath: '/hive/v1/auth/provider-authorizations/github' }
      ]
    },
    {
      contractRevision: 'hive-login-capabilities-v1',
      clientId: 'hivecode-desktop',
      defaultMethod: 'phone_sms',
      providers: [],
      extra: true
    }
  ])('rejects malformed or extended login capability payload %#', async (payload) => {
    const client = new HiveAccountClient(config, vi.fn().mockResolvedValue(jsonResponse(payload)))
    await expect(client.getLoginCapabilities()).rejects.toThrow(/invalid_hive_account_login/)
  })

  it('sends the exact device authorization and session exchange contracts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            contractRevision: 'stage2a-device-authorization-v2'
          },
          201
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: '2030-01-01T00:00:00Z',
          sessionExpiresAt: '2030-04-01T00:00:00Z',
          sessionProfile: 'TRUSTED',
          account: {
            accountId: '123e4567-e89b-42d3-a456-426614174000',
            displayName: 'Ada'
          },
          authorityId: 'hive-primary',
          stepUpSatisfied: false,
          mfaSatisfied: false
        })
      )
    const client = new HiveAccountClient(config, fetchMock)
    await client.createDeviceAuthorization({
      nonce: 'nonce',
      devicePublicKey: 'public',
      deviceLabel: 'desktop',
      sessionProfile: 'TRUSTED',
      proof: 'proof'
    })
    await expect(
      client.exchangeSession({
        authorizationCode: 'code',
        codeVerifier: 'verifier',
        redirectUri: 'http://127.0.0.1:32123',
        nonce: 'nonce'
      })
    ).resolves.toMatchObject({ account: { displayName: 'Ada' }, authorityId: 'hive-primary' })
    const deviceBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(deviceBody).toEqual({
      nonce: 'nonce',
      devicePublicKey: 'public',
      deviceLabel: 'desktop',
      sessionProfile: 'TRUSTED',
      proof: 'proof',
      clientId: 'hivecode-desktop'
    })
    const exchangeBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(exchangeBody.clientId).toBe('hivecode-desktop')
    expect(exchangeBody).not.toHaveProperty('devicePublicKey')
  })

  it('revokes the current session with its security version and an idempotency key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              cloudSessionId: '223e4567-e89b-42d3-a456-426614174000',
              securityVersion: 4,
              currentSession: true
            }
          ],
          nextCursor: null
        })
      )
      .mockResolvedValueOnce(jsonResponse({ revoked: true }))
    const client = new HiveAccountClient(config, fetchMock)
    const sessions = await client.listCloudSessions('access')
    await client.revokeSession('access', sessions[0])
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      authorization: 'Bearer access',
      'idempotency-key': expect.stringMatching(/^[A-Za-z0-9_-]{32}$/)
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      expectedSecurityVersion: 4,
      reason: 'owner_sign_out'
    })
  })

  it('rejects an already expired session response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: '2020-01-01T00:00:00Z',
        sessionExpiresAt: '2020-01-02T00:00:00Z',
        sessionProfile: 'TEMPORARY',
        account: {
          accountId: '123e4567-e89b-42d3-a456-426614174000',
          displayName: 'Ada'
        },
        authorityId: 'hive-primary'
      })
    )
    const client = new HiveAccountClient(config, fetchMock)
    await expect(client.refreshSession('refresh')).rejects.toThrow(
      'expired_hive_account_session_response'
    )
  })
})
