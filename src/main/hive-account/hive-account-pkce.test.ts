import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string) => Promise<void>>()
}))

vi.mock('electron', () => ({
  shell: { openExternal: electronMocks.openExternal }
}))

import { HIVE_ACCOUNT_CLIENT_ID } from './hive-account-config'
import { beginHiveAccountPkceFlow } from './hive-account-pkce'
import { APP_DISPLAY_NAME } from '../../shared/brand'

describe('beginHiveAccountPkceFlow', () => {
  it('uses the Keycloak native-app loopback redirect with a random port and no path', async () => {
    let openedUrl = ''
    electronMocks.openExternal.mockImplementation(async (url) => {
      openedUrl = url
    })

    const authorization = beginHiveAccountPkceFlow({
      authorizationEndpoint:
        'https://identity.hivekernel.com/realms/hive/protocol/openid-connect/auth',
      clientId: HIVE_ACCOUNT_CLIENT_ID,
      scope: 'openid hive.session.exchange',
      prepareDeviceAuthorization: async () => undefined
    })

    await vi.waitFor(() => expect(openedUrl).not.toBe(''))
    const authorizeUrl = new URL(openedUrl)
    const redirectUri = authorizeUrl.searchParams.get('redirect_uri')
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(authorizeUrl.searchParams.get('client_id')).toBe(HIVE_ACCOUNT_CLIENT_ID)
    expect(authorizeUrl.searchParams.get('response_type')).toBe('code')
    expect(authorizeUrl.searchParams.get('scope')).toBe('openid hive.session.exchange')
    expect(authorizeUrl.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorizeUrl.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorizeUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizeUrl.searchParams.has('acr_values')).toBe(false)
    expect(authorizeUrl.searchParams.has('max_age')).toBe(false)
    expect(authorizeUrl.searchParams.has('prompt')).toBe(false)

    const callback = new URL(redirectUri!)
    callback.searchParams.set('code', 'authorization-code')
    callback.searchParams.set('state', authorizeUrl.searchParams.get('state')!)
    const response = await fetch(callback)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain(`Signed in to ${APP_DISPLAY_NAME}`)
    await expect(authorization).resolves.toMatchObject({
      authorizationCode: 'authorization-code',
      redirectUri
    })
  })

  it('opens Console SMS login while keeping the verifier local and rejecting a wrong state', async () => {
    let openedUrl = ''
    let preparedNonce = ''
    electronMocks.openExternal.mockImplementation(async (url) => {
      openedUrl = url
    })
    const authorization = beginHiveAccountPkceFlow({
      authorizationEndpoint:
        'https://identity.hivekernel.com/realms/hive/protocol/openid-connect/auth',
      userLoginUrl: 'https://console.hivekernel.com/login',
      clientId: HIVE_ACCOUNT_CLIENT_ID,
      scope: 'openid hive.session.exchange',
      prepareDeviceAuthorization: async (nonce) => {
        preparedNonce = nonce
      }
    })
    await vi.waitFor(() => expect(openedUrl).not.toBe(''))
    const loginUrl = new URL(openedUrl)
    expect(loginUrl.origin + loginUrl.pathname).toBe('https://console.hivekernel.com/login')
    expect(loginUrl.search).toBe('')
    const context = JSON.parse(
      Buffer.from(loginUrl.hash.slice('#native='.length), 'base64url').toString()
    )
    expect(Object.keys(context).sort()).toEqual([
      'clientId',
      'codeChallenge',
      'nonce',
      'redirectUri',
      'state'
    ])
    expect(context.nonce).toBe(preparedNonce)
    expect(context.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const callback = new URL(context.redirectUri)
    callback.searchParams.set('code', 'sms-code')
    callback.searchParams.set('state', 'wrong-state')
    expect((await fetch(callback)).status).toBe(400)
    callback.searchParams.set('state', context.state)
    expect((await fetch(callback)).status).toBe(200)
    const result = await authorization
    expect(result.authorizationCode).toBe('sms-code')
    expect(openedUrl).not.toContain(result.codeVerifier)
  })

  it('requests a fresh LoA 2 authentication only for an explicit step-up flow', async () => {
    let openedUrl = ''
    electronMocks.openExternal.mockImplementation(async (url) => {
      openedUrl = url
    })

    const authorization = beginHiveAccountPkceFlow({
      authorizationEndpoint:
        'https://identity.hivekernel.com/realms/hive/protocol/openid-connect/auth',
      clientId: HIVE_ACCOUNT_CLIENT_ID,
      scope: 'openid hive.session.exchange',
      acrValues: 'urn:hive:acr:step-up',
      maxAgeSeconds: 0,
      prompt: 'login',
      prepareDeviceAuthorization: async () => undefined
    })

    await vi.waitFor(() => expect(openedUrl).not.toBe(''))
    const authorizeUrl = new URL(openedUrl)
    expect(authorizeUrl.searchParams.get('acr_values')).toBe('urn:hive:acr:step-up')
    expect(authorizeUrl.searchParams.get('max_age')).toBe('0')
    expect(authorizeUrl.searchParams.get('prompt')).toBe('login')

    const callback = new URL(authorizeUrl.searchParams.get('redirect_uri')!)
    callback.searchParams.set('code', 'step-up-code')
    callback.searchParams.set('state', authorizeUrl.searchParams.get('state')!)
    expect((await fetch(callback)).status).toBe(200)
    await expect(authorization).resolves.toMatchObject({ authorizationCode: 'step-up-code' })
  })
})
