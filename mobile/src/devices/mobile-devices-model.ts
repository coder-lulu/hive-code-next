import { classifyConnection } from '../transport/connection-health'
import { resolveHomeHostConnectionState } from '../transport/home-host-auto-connect'
import { hostCatalogEntryHasLocalPairing } from '../runtime-directory/account-runtime-catalog'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import type { ConnectionState, HostCatalogEntry } from '../transport/types'

export type MobileDevice = {
  host: HostCatalogEntry
  connected: boolean
  connecting: boolean
  current: boolean
  requiresPairing: boolean
  label: string
  hint: string
  tone: 'success' | 'busy' | 'neutral' | 'danger'
  source: string
  lastConnectedAt: number | null
  lastPresenceAt: number | null
}
export type MobileDeviceFilter = 'all' | 'connected' | 'disconnected'

export function projectMobileDevices(args: {
  catalog: readonly HostCatalogEntry[]
  states: Readonly<Record<string, ConnectionState>>
  selectedId: string | null
  autoConnectHostIds: readonly string[]
  attempts: Readonly<Record<string, number>>
  lastConnected: Readonly<Record<string, number | null>>
  pendingPaths: Readonly<Record<string, MobileConnectionPath | null>>
  pairingRejected: Readonly<Record<string, boolean>>
  signedOut: Readonly<Record<string, boolean>>
  lastPresence?: Readonly<Record<string, number | null>>
}): MobileDevice[] {
  return args.catalog.map((host) => {
    const state = resolveHomeHostConnectionState(
      host.id,
      args.states[host.id],
      args.autoConnectHostIds
    )
    const lastConnectedAt =
      args.lastConnected[host.id] ?? (host.lastConnected > 0 ? host.lastConnected : null)
    const verdict = classifyConnection({
      state,
      reconnectAttempts: args.attempts[host.id] ?? 0,
      lastConnectedAt,
      endpoint: host.endpoint,
      pendingPath: args.pendingPaths[host.id],
      pairingRejected: args.pairingRejected[host.id],
      hostSignedOut: args.signedOut[host.id]
    })
    // `state` is projected from a currently registered shared client. That
    // authenticated live connection outranks stale directory availability;
    // only an explicit credential revocation may invalidate it.
    const connected = state === 'connected' && host.credentialStatus !== 'missing'
    const account = host.accessSources?.includes('account-claimed') ?? false
    const requiresPairing =
      hostCatalogEntryHasLocalPairing(host) &&
      !host.profile?.accountRuntime &&
      (host.credentialStatus === 'missing' || verdict.kind === 'auth-failed')
    const base = {
      host,
      connected,
      current: connected && host.id === args.selectedId,
      requiresPairing,
      source: account ? '账号设备' : '本地配对',
      lastConnectedAt,
      lastPresenceAt: host.runtimeRecordId
        ? (args.lastPresence?.[host.runtimeRecordId] ?? null)
        : null
    }
    if (connected) {
      return { ...base, connecting: false, label: '已连接', hint: '连接已建立', tone: 'success' }
    }
    if (host.credentialStatus === 'missing' || verdict.kind === 'auth-failed') {
      return {
        ...base,
        connecting: false,
        label: requiresPairing ? '需重新配对' : '连接未通过',
        hint: requiresPairing
          ? '配对已失效，请重新扫描电脑端二维码'
          : '账号连接未通过，请查看连接详情',
        tone: 'danger'
      }
    }
    if (host.credentialStatus !== 'ready') {
      const hint =
        host.credentialStatus === 'temporarily-unavailable'
          ? '配对凭据暂时不可用，解锁手机后重试'
          : host.credentialStatus === 'cloud-offline'
            ? '电脑未连接 HiveCloud，恢复连接后重试'
            : '电脑当前没有可用的安全中继连接'
      return { ...base, connecting: false, label: '暂不可达', hint, tone: 'neutral' }
    }
    if (verdict.kind === 'unreachable' || verdict.kind === 'warning') {
      return {
        ...base,
        connecting: false,
        label: '暂不可达',
        hint: args.signedOut[host.id]
          ? '请在电脑端登录 HiveCloud 后重试'
          : verdict.hint
            ? '请确认手机与电脑的 Tailscale 网络可达'
            : '连接暂时无法确认，请重试或查看详情',
        tone: 'neutral'
      }
    }
    if (
      state === 'disconnected' &&
      host.accountPresence === 'ONLINE' &&
      host.credentialStatus === 'ready'
    ) {
      return {
        ...base,
        connecting: false,
        label: '在线',
        hint: '电脑已连接 HiveCloud，可按需建立会话',
        tone: 'success'
      }
    }
    const connecting = state === 'connecting' || state === 'handshaking' || state === 'reconnecting'
    return {
      ...base,
      connecting,
      label: connecting ? '连接中' : '未连接',
      hint: connecting
        ? state === 'handshaking'
          ? '正在验证连接…'
          : '正在恢复连接…'
        : '尚未建立连接',
      tone: connecting ? 'busy' : 'neutral'
    }
  })
}

export function filterMobileDevices(devices: readonly MobileDevice[], filter: MobileDeviceFilter) {
  return devices.filter(
    (device) => filter === 'all' || device.connected === (filter === 'connected')
  )
}

export function mobileDeviceLastConnectedLabel(
  timestamp: number | null,
  now: number,
  observation: 'connection' | 'presence' = 'connection'
): string {
  if (timestamp == null) {
    return '尚未连接过'
  }
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000)
  const prefix = observation === 'presence' ? '最近在线' : '最近连接'
  if (minutes < 1) {
    return `${prefix}：刚刚`
  }
  if (minutes < 60) {
    return `${prefix}：${minutes} 分钟前`
  }
  if (minutes < 1440) {
    return `${prefix}：${Math.floor(minutes / 60)} 小时前`
  }
  return `${prefix}：${Math.floor(minutes / 1440)} 天前`
}
