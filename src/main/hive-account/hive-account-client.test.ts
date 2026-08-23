import { describe, expect, it, vi } from 'vitest'
import { HiveAccountClient } from './hive-account-client'

const config = {
  apiBaseUrl: 'https://api.hivekernel.com',
  identityIssuer: 'https://identity.hivekernel.com/realms/hive',
  clientId: 'hivecode-desktop',
  scope: 'openid profile email offline_access hive.session.exchange'
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('Hive account Native client', () => {
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

  it('sends the exact device authorization and session exchange contracts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            contractRevision: 'stage2a-device-authorization-v1'
          },
          201
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: '2030-01-01T00:00:00Z',
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
      proof: 'proof'
    })
    await expect(
      client.exchangeSession({
        authorizationCode: 'code',
        codeVerifier: 'verifier',
        redirectUri: 'http://127.0.0.1:32123/auth/callback',
        nonce: 'nonce'
      })
    ).resolves.toMatchObject({ account: { displayName: 'Ada' }, authorityId: 'hive-primary' })
    const deviceBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(deviceBody).toEqual({
      nonce: 'nonce',
      devicePublicKey: 'public',
      deviceLabel: 'desktop',
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
