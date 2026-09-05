import { describe, expect, it } from 'vitest'
import type { ConnectionState } from '../transport/types'
import { presentRuntimeConnection } from './runtime-connection-presentation'

describe('presentRuntimeConnection', () => {
  it.each<readonly [ConnectionState, string, string]>([
    ['connected', '在线', '已连接'],
    ['connecting', '连接', '正在连接'],
    ['handshaking', '验证', '正在验证连接'],
    ['reconnecting', '重连', '正在重连'],
    ['auth-failed', '失效', '配对已失效'],
    ['disconnected', '离线', '连接不可验证']
  ])('presents %s without relying on color', (state, label, accessibilityLabel) => {
    expect(presentRuntimeConnection(state)).toMatchObject({ label, accessibilityLabel })
  })

  it('uses semantic tones for visible status text', () => {
    expect(presentRuntimeConnection('connected').tone).toBe('success')
    expect(presentRuntimeConnection('reconnecting').tone).toBe('warning')
    expect(presentRuntimeConnection('auth-failed').tone).toBe('danger')
    expect(presentRuntimeConnection('disconnected').tone).toBe('neutral')
  })
})
