import { Activity, Edit3, PowerOff, RefreshCw, Users } from 'lucide-react-native'
import type { ActionSheetAction } from './components/ActionSheetModal'
import { hostCatalogEntryHasLocalPairing } from './runtime-directory/account-runtime-catalog'
import type { ConnectionState, HostCatalogEntry } from './transport/types'

/** Builds the home-screen host long-press menu. Navigation and second drawers
 *  defer until this sheet's native Modal has unmounted —
 *  presenting into a live one freezes the whole screen on iOS (issue #8791). */
export function getHostListActionSheetActions(args: {
  host: HostCatalogEntry | null
  state: ConnectionState
  /** Label "Connect" (not "Reconnect") when never connected this session, so the verb matches the action. */
  hasEverConnected: boolean
  onDismiss: () => void
  onReconnect?: (hostId: string) => void
  onDisconnect: (hostId: string) => void
  onDiagnostics: (hostId: string) => void
  onEdit: (hostId: string) => void
  onSessions?: (hostId: string) => void
  onRemove: (host: HostCatalogEntry) => void
}): ActionSheetAction[] {
  const { host } = args
  if (!host) {
    return []
  }
  const isLive =
    args.state === 'connected' ||
    args.state === 'connecting' ||
    args.state === 'handshaking' ||
    args.state === 'reconnecting'
  const accountRuntime = host.accessSources?.includes('account-claimed') === true
  const canConnect = Boolean(host.profile && args.onReconnect)

  return [
    {
      label: args.hasEverConnected && isLive ? '重新连接' : '连接',
      icon: RefreshCw,
      disabled: !canConnect,
      hint: canConnect ? undefined : '当前运行环境尚不可连接',
      onPress: () => {
        args.onDismiss()
        args.onReconnect?.(host.id)
      }
    },
    ...(isLive
      ? [
          {
            label: '断开当前手机连接',
            icon: PowerOff,
            onPress: () => {
              args.onDismiss()
              args.onDisconnect(host.id)
            }
          }
        ]
      : []),
    {
      label: '网络诊断',
      icon: Activity,
      disabled: !host.profile,
      hint: host.profile ? undefined : '连接资料暂不可用',
      closeBeforePress: true,
      onPress: () => {
        args.onDiagnostics(host.id)
      }
    },
    {
      label: accountRuntime ? '修改云端别名' : '修改别名与连接地址',
      icon: Edit3,
      closeBeforePress: true,
      onPress: () => {
        args.onDismiss()
        args.onEdit(host.id)
      }
    },
    ...(accountRuntime && host.runtimeRecordId
      ? [
          {
            label: '会话管理',
            icon: Users,
            disabled: !args.onSessions,
            closeBeforePress: true,
            onPress: () => args.onSessions?.(host.id)
          }
        ]
      : []),
    ...(hostCatalogEntryHasLocalPairing(host)
      ? [
          {
            label: '移除本地配对',
            destructive: true,
            closeBeforePress: true,
            onPress: () => args.onRemove(host)
          }
        ]
      : [])
  ]
}
