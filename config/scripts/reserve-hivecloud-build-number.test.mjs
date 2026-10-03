import { describe, expect, it, vi } from 'vitest'
import { reserveHiveCloudBuildNumber } from './reserve-hivecloud-build-number.mjs'

const environment = {
  HIVECLOUD_API_URL: 'https://updates.hive.test',
  HIVECLOUD_API_TOKEN: 'secret-token',
  HIVECODE_RELEASE_PLATFORM: 'android',
  HIVECODE_RELEASE_CHANNEL: 'beta',
  HIVECODE_BUILD_RESERVATION_KEY: 'hivecode:android:beta:1.5.0-beta.1',
  HIVECODE_EXPECTED_BUILD_NUMBER: '14'
}

describe('HiveCloud build number reservation', () => {
  it('requests and verifies an idempotent platform build number', async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { buildNumber: 14 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )

    await expect(reserveHiveCloudBuildNumber(environment, request)).resolves.toBe(14)
    expect(request).toHaveBeenCalledOnce()
    const [url, options] = request.mock.calls[0]
    expect(url).toBe('https://updates.hive.test/hive/v1/admin/releases/build-numbers/reserve')
    expect(options.redirect).toBe('error')
    expect(JSON.parse(options.body)).toMatchObject({
      product: 'hivecode',
      platform: 'android',
      channel: 'beta',
      requestedBuildNumber: 14,
      reservationKey: 'hivecode:android:beta:1.5.0-beta.1'
    })
  })

  it('rejects a server build that differs from the native package identity', async () => {
    const request = vi.fn(
      async () => new Response(JSON.stringify({ data: { buildNumber: 15 } }), { status: 200 })
    )
    await expect(reserveHiveCloudBuildNumber(environment, request)).rejects.toThrow(
      'reserved build 15, expected 14'
    )
  })
})
