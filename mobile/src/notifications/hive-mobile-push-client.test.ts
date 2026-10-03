import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-secure-store', () => ({}))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length),
  randomUUID: () => '11111111-1111-4111-8111-111111111111'
}))
import type { MobileSession } from '../auth/mobile-sms-session'
import {
  acknowledgeHiveMobilePushPresentation,
  registerHiveMobilePush,
  unregisterHiveMobilePush
} from './hive-mobile-push-client'

const session: MobileSession = {
  accessToken: 'mobile-access-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 60_000,
  sessionExpiresAt: Date.now() + 120_000,
  sessionProfile: 'TRUSTED',
  account: { accountId: 'account-id', displayName: 'User' },
  authorityId: 'authority-id'
}

afterEach(() => vi.unstubAllGlobals())

describe('Hive mobile push registration client', () => {
  it('registers the native token against the current authenticated device', async () => {
    const fetchMock = vi.fn(
      async (_input: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            registrationId: '11111111-1111-4111-8111-111111111111',
            expiresAt: '2030-01-01T00:00:00.000Z',
            deliveryAvailable: true
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      registerHiveMobilePush(session, {
        platform: 'IOS',
        token: 'native-apns-token',
        apnsEnvironment: 'PRODUCTION'
      })
    ).resolves.toEqual({
      registrationId: '11111111-1111-4111-8111-111111111111',
      expiresAt: Date.parse('2030-01-01T00:00:00.000Z'),
      deliveryAvailable: true
    })
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(
      '/hive/v1/mobile-push/registrations/current'
    )
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer mobile-access-token' }),
        body: JSON.stringify({
          platform: 'IOS',
          token: 'native-apns-token',
          apnsEnvironment: 'PRODUCTION'
        })
      })
    )
  })

  it('unregisters without sending a DELETE request body', async () => {
    const fetchMock = vi.fn(
      async (_input: string, _init: RequestInit) => new Response(null, { status: 204 })
    )
    vi.stubGlobal('fetch', fetchMock)
    await unregisterHiveMobilePush(session)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'DELETE',
      headers: expect.objectContaining({ Authorization: 'Bearer mobile-access-token' })
    })
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body')
  })

  it('acknowledges a presented delivery with the current bearer session', async () => {
    const fetchMock = vi.fn(
      async (_input: string, _init: RequestInit) => new Response(null, { status: 204 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await acknowledgeHiveMobilePushPresentation(session, '22222222-2222-4222-8222-222222222222')

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(
      '/hive/v1/mobile-push/notifications/presentations/current'
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: 'Bearer mobile-access-token' }),
      body: JSON.stringify({ deliveryId: '22222222-2222-4222-8222-222222222222' })
    })
  })
})
