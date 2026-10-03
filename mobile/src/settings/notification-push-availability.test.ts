import { describe, expect, it } from 'vitest'
import { hiveMobilePushAvailabilityCopy } from './hive-mobile-push-availability-copy'

describe('HiveCloud push availability copy', () => {
  it('distinguishes available, missing native token, Cloud outage, and signed-out states', () => {
    expect(hiveMobilePushAvailabilityCopy({ status: 'available' })).toMatchObject({
      status: '已开启 · 离线推送可用',
      unavailable: false
    })
    expect(
      hiveMobilePushAvailabilityCopy({ status: 'unavailable', reason: 'token_unavailable' })
    ).toMatchObject({
      status: '已开启 · 离线推送不可用',
      detail: expect.stringContaining('Firebase/APNs'),
      unavailable: true
    })
    expect(
      hiveMobilePushAvailabilityCopy({ status: 'unavailable', reason: 'cloud_unavailable' })
    ).toMatchObject({
      detail: expect.stringContaining('HiveCloud'),
      unavailable: true
    })
    expect(
      hiveMobilePushAvailabilityCopy({ status: 'unavailable', reason: 'not_authenticated' })
    ).toMatchObject({ status: '已开启 · 待登录', unavailable: true })
  })
})
