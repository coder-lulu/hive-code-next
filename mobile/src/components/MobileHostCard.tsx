import { productNameText } from '@/product-brand'
import { Monitor, MoreVertical } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { ConnectionVerdict } from '../transport/connection-health'
import { verdictDisplayLabel } from '../transport/connection-health'
import { mobileConnectionPathLabel } from '../transport/mobile-connection-path-label'
import { useHostDisplay } from '../transport/use-host-display'
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
  const cloudOffline = props.credentialStatus === 'cloud-offline'
  const cloudUnavailable = props.credentialStatus === 'cloud-unavailable'
  // A live authenticated client is newer evidence than the polled cloud
  // directory. Only an explicitly revoked local credential may veto it.
  const connected = props.state === 'connected' && !credentialMissing
  const accountOnline =
    !connected &&
    props.state === 'disconnected' &&
    props.verdict.kind === 'normal' &&
    props.verdict.label === 'Disconnected' &&
    props.credentialStatus === 'ready' &&
    'accountPresence' in props.host &&
    props.host.accountPresence === 'ONLINE'
  const isError =
    credentialMissing || ['warning', 'unreachable', 'auth-failed'].includes(props.verdict.kind)
  const statusLabel = credentialMissing
    ? '配对已失效'
    : connected
      ? localizeConnectionStatus(verdictDisplayLabel(props.verdict))
      : credentialUnavailable
        ? '配对凭据暂时不可用'
        : cloudOffline
          ? 'Runtime 离线'
          : cloudUnavailable
            ? '云连接暂不可用'
            : accountOnline
              ? '在线'
              : localizeConnectionStatus(verdictDisplayLabel(props.verdict))
  const statusVerdict: ConnectionVerdict = credentialMissing
    ? { kind: 'auth-failed', label: statusLabel }
    : connected
      ? props.verdict
      : credentialUnavailable
        ? { kind: 'warning', label: statusLabel }
        : cloudOffline
          ? { kind: 'normal', label: statusLabel }
          : cloudUnavailable
            ? { kind: 'warning', label: statusLabel }
            : accountOnline
              ? { kind: 'normal', label: statusLabel }
              : props.verdict
  const worktreeSummary = homeHostWorktreeSummary(props.worktreeInfo)
  const localizedWorktreeSummary = localizeWorktreeSummary(worktreeSummary)
  const display = useHostDisplay(props.host)
  const descriptorText = display.descriptorLine
  const connectionPathLabel =
    !credentialMissing && connected
      ? localizeConnectionPath(mobileConnectionPathLabel(props.path))
      : null
  const discoveryHint =
    !cloudOffline && !cloudUnavailable && props.verdict.kind === 'unreachable'
      ? productNameText('更新桌面端 Orca 并登录，以便随时随地连接')
      : null
  const credentialHint = connected
    ? null
    : credentialMissing
      ? '点击与桌面端重新配对'
      : credentialUnavailable
        ? '解锁手机后点击重试'
        : cloudOffline
          ? 'Runtime 重新连接 HiveCloud 后即可使用'
          : cloudUnavailable
            ? '请更新 Runtime，或等待运营侧启用安全中继'
            : null
  // The verdict's own second line (what to check on the desktop); credential copy wins.
  const verdictDetail =
    credentialHint === null && 'detail' in props.verdict ? (props.verdict.detail ?? null) : null
  const accessibilityLabel = [
    `打开 ${display.title}`,
    descriptorText,
    statusLabel,
    connectionPathLabel?.replaceAll(' · ', '，'),
    connected ? localizedWorktreeSummary?.replaceAll(' · ', '，') : null,
    discoveryHint,
    credentialHint,
    verdictDetail
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
            {display.title}
          </Text>
          {descriptorText ? (
            <Text style={styles.platformText} numberOfLines={1}>
              {descriptorText}
            </Text>
          ) : null}
          <View style={styles.meta}>
            <StatusDot
              state={accountOnline ? 'connected' : props.state}
              verdict={statusVerdict}
              theme={props.theme}
            />
            <Text
              style={[
                styles.metaText,
                isError && { color: props.theme.color.status.dangerText },
                credentialUnavailable && { color: props.theme.color.status.warningText }
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
          {verdictDetail ? (
            <Text style={styles.discoveryHint} numberOfLines={2}>
              {verdictDetail}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${display.title} 的更多操作`}
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
    platformText: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space4
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
