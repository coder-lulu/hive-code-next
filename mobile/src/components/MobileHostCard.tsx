import { productNameText } from '@/product-brand'
import { Monitor, MoreVertical } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { ConnectionVerdict } from '../transport/connection-health'
import { verdictDisplayLabel } from '../transport/connection-health'
import { mobileConnectionPathLabel } from '../transport/mobile-connection-path-label'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import type { ConnectionState, HostCatalogEntry, HostProfile } from '../transport/types'
import type { MobileTheme } from '../theme/mobile-theme'
import { homeHostWorktreeSummary, type HostWorktreeInfo } from '../worktree/home-worktree-info'
import { StatusDot } from './StatusDot'

export function MobileHostCard(props: {
  theme: MobileTheme
  host: HostProfile | HostCatalogEntry
  credentialStatus?: HostCatalogEntry['credentialStatus']
  state: ConnectionState
  verdict: ConnectionVerdict
  path: MobileConnectionPath
  // Why: the card owns the fresh/stale/unavailable wording so no caller can re-gate the counts
  // away (STA-3123 shipped that bug once already).
  worktreeInfo?: HostWorktreeInfo
  onPress: () => void
  onLongPress: () => void
  onOpenActions: () => void
}) {
  const styles = createStyles(props.theme)
  const credentialUnavailable = props.credentialStatus === 'temporarily-unavailable'
  const credentialMissing = props.credentialStatus === 'missing'
  const connected = props.state === 'connected' && !credentialUnavailable && !credentialMissing
  const isError =
    credentialMissing || ['warning', 'unreachable', 'auth-failed'].includes(props.verdict.kind)
  const statusLabel = credentialMissing
    ? '配对已失效'
    : credentialUnavailable
      ? '配对凭据暂时不可用'
      : localizeConnectionStatus(verdictDisplayLabel(props.verdict))
  const statusVerdict: ConnectionVerdict = credentialMissing
    ? { kind: 'auth-failed', label: statusLabel }
    : credentialUnavailable
      ? { kind: 'warning', label: statusLabel }
      : props.verdict
  const worktreeSummary = homeHostWorktreeSummary(props.worktreeInfo)
  const localizedWorktreeSummary = localizeWorktreeSummary(worktreeSummary)
  const connectionPathLabel =
    !credentialMissing && !credentialUnavailable && connected
      ? localizeConnectionPath(mobileConnectionPathLabel(props.path))
      : null
  const discoveryHint =
    props.verdict.kind === 'unreachable' && !props.host.relay
      ? productNameText('更新桌面端 Orca 并登录，以便随时随地连接')
      : null
  const credentialHint = credentialMissing
    ? '点击与桌面端重新配对'
    : credentialUnavailable
      ? '解锁手机后点击重试'
      : null
  const accessibilityLabel = [
    `打开 ${props.host.name}`,
    statusLabel,
    connectionPathLabel?.replaceAll(' · ', '，'),
    connected ? localizedWorktreeSummary?.replaceAll(' · ', '，') : null,
    discoveryHint,
    credentialHint
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.cardMain, pressed && styles.cardPressed]}
        onPress={props.onPress}
        onLongPress={props.onLongPress}
        delayLongPress={400}
      >
        <View style={styles.icon}>
          <Monitor
            size={20}
            color={connected ? props.theme.color.text.primary : props.theme.color.text.secondary}
          />
        </View>
        <View style={styles.main}>
          <Text
            style={[styles.name, !connected && { color: props.theme.color.text.secondary }]}
            numberOfLines={1}
          >
            {props.host.name}
          </Text>
          <View style={styles.meta}>
            <StatusDot state={props.state} verdict={statusVerdict} theme={props.theme} />
            <Text
              style={[
                styles.metaText,
                isError && { color: props.theme.color.status.danger },
                credentialUnavailable && { color: props.theme.color.status.warning }
              ]}
              numberOfLines={1}
            >
              {statusLabel}
              {connectionPathLabel ? ` · ${connectionPathLabel}` : ''}
            </Text>
          </View>
          {connected && localizedWorktreeSummary ? (
            <Text style={styles.worktreeMetaText} numberOfLines={1}>
              {localizedWorktreeSummary}
            </Text>
          ) : null}
          {discoveryHint ? (
            <Text style={styles.discoveryHint} numberOfLines={2}>
              {discoveryHint}
            </Text>
          ) : null}
          {credentialHint ? (
            <Text style={styles.discoveryHint} numberOfLines={2}>
              {credentialHint}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.host.name} 的更多操作`}
        hitSlop={8}
        style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
        onPress={props.onOpenActions}
      >
        <MoreVertical size={18} color={props.theme.color.text.secondary} />
      </Pressable>
    </View>
  )
}

const STATUS_TRANSLATIONS: Readonly<Record<string, string>> = {
  Connected: '已连接',
  Disconnected: '未连接',
  'Connecting…': '正在连接…',
  'Reconnecting…': '正在重新连接…',
  'Connecting via Relay…': '正在通过安全中继连接…',
  "Can't connect": '无法连接',
  "Can't connect via Relay": '无法通过安全中继连接',
  "Can't reach desktop": '无法访问桌面端',
  'Pairing invalid': '配对已失效',
  'Pairing invalid — re-pair with your desktop': '配对已失效，请与桌面端重新配对'
}

function localizeConnectionStatus(label: string): string {
  const [status, hint] = label.split(' — ')
  const localizedStatus = STATUS_TRANSLATIONS[status ?? ''] ?? status ?? label
  return hint === 'check Tailscale' ? `${localizedStatus} — 请检查 Tailscale` : localizedStatus
}

function localizeConnectionPath(label: string): string {
  return label.replace('Relay', '安全中继').replace('Direct', '直连').replace('LAN', '局域网')
}

function localizeWorktreeSummary(summary: string | null): string | null {
  if (!summary) {
    return null
  }
  if (summary === 'Worktree list unavailable') {
    return '工作区列表不可用'
  }
  return summary
    .replace(/^Last known: /, '上次状态：')
    .replace(/(\d+) worktrees?/, '$1 个工作区')
    .replace(/(\d+) active/, '$1 个活跃')
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    card: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    cardMain: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: theme.spacing.space12,
      paddingVertical: theme.spacing.space12
    },
    cardPressed: { backgroundColor: theme.color.bg.subtle },
    icon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    main: { flex: 1, minWidth: 0, marginRight: theme.spacing.space8 },
    name: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    meta: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      marginTop: theme.spacing.space4
    },
    metaText: { ...theme.typography.caption, flex: 1, color: theme.color.text.secondary },
    worktreeMetaText: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space4,
      marginLeft: theme.spacing.space16,
      color: theme.color.text.tertiary
    },
    discoveryHint: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space4,
      color: theme.color.text.tertiary
    },
    actionButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      marginHorizontal: theme.spacing.space4,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    actionButtonPressed: { backgroundColor: theme.color.bg.subtle }
  })
}
