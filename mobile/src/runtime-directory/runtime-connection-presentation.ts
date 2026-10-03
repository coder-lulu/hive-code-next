import type { ConnectionState, HostCatalogEntry } from '../transport/types'
import { presentRuntimeCatalogStatus } from './runtime-selector-presentation'

export type RuntimeConnectionTone = 'success' | 'warning' | 'danger' | 'neutral'

export type RuntimeConnectionPresentation = Readonly<{
  accessibilityLabel: string
  label: string
  tone: RuntimeConnectionTone
}>

/** Compact, non-color-only connection copy for narrow mobile headers. */
export function presentRuntimeConnection(
  state: ConnectionState,
  runtime?: HostCatalogEntry
): RuntimeConnectionPresentation {
  switch (state) {
    case 'connected':
      return { accessibilityLabel: '已连接', label: '在线', tone: 'success' }
    case 'connecting':
      return { accessibilityLabel: '正在连接', label: '连接', tone: 'warning' }
    case 'handshaking':
      return { accessibilityLabel: '正在验证连接', label: '验证', tone: 'warning' }
    case 'reconnecting':
      return { accessibilityLabel: '正在重连', label: '重连', tone: 'warning' }
    case 'auth-failed':
      return { accessibilityLabel: '配对已失效', label: '失效', tone: 'danger' }
    case 'disconnected':
      if (runtime) {
        const { statusLabel, tone } = presentRuntimeCatalogStatus(runtime, state)
        return {
          accessibilityLabel: statusLabel === '在线' ? '主机在线，尚未建立连接' : statusLabel,
          label: statusLabel,
          tone
        }
      }
      return { accessibilityLabel: '尚未建立连接', label: '未连接', tone: 'neutral' }
  }
}
