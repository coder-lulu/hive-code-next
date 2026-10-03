import { describe, expect, it } from 'vitest'
import type { ConnectionState, HostCatalogEntry } from '../transport/types'
import { presentRuntimeConnection } from './runtime-connection-presentation'

describe('presentRuntimeConnection', () => {
  it.each<readonly [ConnectionState, string, string]>([
    ['connected', '在线', '已连接'],
    ['connecting', '连接', '正在连接'],
    ['handshaking', '验证', '正在验证连接'],
    ['reconnecting', '重连', '正在重连'],
    ['auth-failed', '失效', '配对已失效'],
    ['disconnected', '未连接', '尚未建立连接']
  ])('presents %s without relying on color', (state, label, accessibilityLabel) => {
    expect(presentRuntimeConnection(state)).toMatchObject({ label, accessibilityLabel })
  })

  it('uses semantic tones for visible status text', () => {
    expect(presentRuntimeConnection('connected').tone).toBe('success')
    expect(presentRuntimeConnection('reconnecting').tone).toBe('warning')
    expect(presentRuntimeConnection('auth-failed').tone).toBe('danger')
    expect(presentRuntimeConnection('disconnected').tone).toBe('neutral')
  })

  const runtime: HostCatalogEntry = {
    id: 'desktop',
    name: 'Desktop',
    endpoint: 'ws://desktop',
    publicKeyB64: 'key',
    lastConnected: 0,
    credentialStatus: 'ready',
    profile: null,
    accessSources: ['account-claimed'],
    accountPresence: 'ONLINE'
  }

  it('shows account presence without claiming the phone is connected', () => {
    expect(presentRuntimeConnection('disconnected', runtime)).toEqual({
      label: '在线',
      tone: 'success',
      accessibilityLabel: '主机在线，尚未建立连接'
    })
  })

  it.each([
    ['cloud-offline', '离线'],
    ['cloud-unavailable', '不可连接'],
    ['temporarily-unavailable', '不可验证'],
    ['missing', '连接未通过']
  ] as const)('preserves %s even with online account presence', (credentialStatus, label) => {
    expect(presentRuntimeConnection('disconnected', { ...runtime, credentialStatus }).label).toBe(
      label
    )
  })

  it.each(['connecting', 'handshaking', 'reconnecting', 'auth-failed'] as const)(
    'does not hide %s behind online presence',
    (state) => {
      expect(presentRuntimeConnection(state, runtime)).toEqual(presentRuntimeConnection(state))
    }
  )

  it('keeps a verified connection authoritative over stale offline presence', () => {
    expect(
      presentRuntimeConnection('connected', {
        ...runtime,
        accountPresence: 'OFFLINE',
        credentialStatus: 'cloud-offline'
      })
    ).toEqual(presentRuntimeConnection('connected'))
  })
})
