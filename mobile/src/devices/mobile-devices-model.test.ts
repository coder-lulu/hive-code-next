import { describe, expect, it } from 'vitest'
import {
  filterMobileDevices,
  mobileDeviceLastConnectedLabel,
  projectMobileDevices
} from './mobile-devices-model'
import { deviceCatalog, deviceProjection, testDevices } from './mobile-devices.test-fixture'

describe('device catalog presentation', () => {
  it('separates the selected connected device and counts every other state as not connected', () => {
    const devices = testDevices()
    expect(devices.map((device) => device.current)).toEqual([true, false, false])
    expect(filterMobileDevices(devices, 'connected')).toHaveLength(1)
    expect(filterMobileDevices(devices, 'disconnected')).toHaveLength(2)
    expect(devices[1]).toMatchObject({ label: '连接中', connecting: true })
    expect(devices[2]).toMatchObject({ source: '账号设备', label: '未连接' })
  })
  it('does not turn account presence or a selected disconnected device into an authenticated connection', () => {
    const devices = projectMobileDevices({
      ...deviceProjection,
      selectedId: 'device-2',
      catalog: deviceCatalog.map((host) => ({ ...host, accountPresence: 'ONLINE' }))
    })
    expect(devices.some((device) => device.current)).toBe(false)
    expect(devices[2].connected).toBe(false)
    expect(devices[2]).toMatchObject({ label: '在线', tone: 'success' })
  })
  it('does not offer connected execution after credentials are explicitly revoked', () => {
    const devices = projectMobileDevices({
      ...deviceProjection,
      catalog: [{ ...deviceCatalog[0], credentialStatus: 'missing' }]
    })
    expect(devices[0].connected).toBe(false)
    expect(devices[0].current).toBe(false)
    expect(devices[0].connecting).toBe(false)
  })
  it.each(['temporarily-unavailable', 'cloud-offline', 'cloud-unavailable'] as const)(
    'prefers an authenticated live client over stale %s directory state',
    (credentialStatus) => {
      const devices = projectMobileDevices({
        ...deviceProjection,
        catalog: [{ ...deviceCatalog[0], credentialStatus }]
      })
      expect(devices[0]).toMatchObject({
        connected: true,
        current: true,
        label: '已连接',
        tone: 'success'
      })
    }
  )
  it('uses the shared connection verdict instead of hiding repeated failures behind connecting', () => {
    const devices = projectMobileDevices({ ...deviceProjection, attempts: { 'device-1': 12 } })
    expect(devices[1]).toMatchObject({ label: '暂不可达', connecting: false })
    expect(devices[1].hint).not.toContain('已停止')
  })
  it.each([
    { accessSources: ['manual-pairing'] as const, requiresPairing: true },
    { accessSources: ['manual-pairing', 'account-claimed'] as const, requiresPairing: true },
    { accessSources: ['account-claimed'] as const, requiresPairing: false }
  ])(
    'keeps rejected local pairing separate from account-only authentication ($accessSources)',
    ({ accessSources, requiresPairing }) => {
      const device = projectMobileDevices({
        ...deviceProjection,
        catalog: [{ ...deviceCatalog[0], accessSources: [...accessSources] }],
        states: { 'device-0': 'auth-failed' }
      })[0]
      expect(device.requiresPairing).toBe(requiresPairing)
      expect(device.label).toBe(requiresPairing ? '需重新配对' : '连接未通过')
      expect(device.current).toBe(false)
    }
  )
  it('keeps auto-connect pending visible and expresses last connection without asserting current presence', () => {
    expect(
      projectMobileDevices({ ...deviceProjection, states: {}, autoConnectHostIds: ['device-0'] })[0]
        .connecting
    ).toBe(true)
    expect(mobileDeviceLastConnectedLabel(null, 1)).toBe('尚未连接过')
    expect(mobileDeviceLastConnectedLabel(1, 30 * 60_000 + 1)).toBe('最近连接：30 分钟前')
    const accountDevice = projectMobileDevices({
      ...deviceProjection,
      catalog: [{ ...deviceCatalog[2], runtimeRecordId: 'account-server' }],
      lastPresence: { 'account-server': 1 }
    })[0]
    expect(accountDevice.lastPresenceAt).toBe(1)
    expect(accountDevice.connected).toBe(false)
    expect(
      mobileDeviceLastConnectedLabel(accountDevice.lastPresenceAt, 30 * 60_000 + 1, 'presence')
    ).toBe('最近在线：30 分钟前')
  })
})
