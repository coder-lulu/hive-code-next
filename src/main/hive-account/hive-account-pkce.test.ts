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
})
