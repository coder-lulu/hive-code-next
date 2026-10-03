import { LoaderCircle, Monitor, MoreHorizontal, RefreshCw } from 'lucide-react-native'
import { Text, View } from 'react-native'
import { MobileIconButton } from '../components/ui/MobileIconButton'
import { PairingActionButton } from '../components/pairing/PairingActionButton'
import type { MobileTheme } from '../theme/mobile-theme'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import { mobileDeviceLastConnectedLabel, type MobileDevice } from './mobile-devices-model'
import { createMobileDevicesStyles } from './mobile-devices-styles'

export function MobileDeviceListItem(props: {
  device: MobileDevice
  theme: MobileTheme
  compact: boolean
  first: boolean
  last: boolean
  now: number
  path?: MobileConnectionPath
  pending: boolean
  onActions: () => void
  onDetails: () => void
  onRetry: () => void
}) {
  const { device, theme } = props
  const styles = createMobileDevicesStyles(theme)
  const color =
    device.tone === 'success'
      ? theme.color.status.success
      : device.tone === 'busy'
        ? theme.color.brand.primary
        : device.tone === 'danger'
          ? theme.color.status.danger
          : theme.color.text.tertiary
  return (
    <View
      style={[
        styles.deviceRow,
        device.current
          ? styles.currentCard
          : [
              props.first && styles.deviceFirst,
              props.last && styles.deviceLast,
              !props.first && styles.deviceBorder
            ]
      ]}
    >
      <View style={[styles.deviceHeader, props.compact && styles.deviceHeaderCompact]}>
        <View style={styles.deviceIcon}>
          <Monitor size={24} strokeWidth={2} color={theme.color.text.primary} />
        </View>
        <View style={[styles.deviceCopy, props.compact && styles.deviceCopyCompact]}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.3}
            numberOfLines={2}
            style={styles.deviceName}
          >
            {device.host.name}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.deviceMeta}>
            {device.source}
          </Text>
        </View>
        <View
          accessible
          accessibilityLabel={`${device.host.name}，${device.label}`}
          style={[styles.status, props.compact && styles.statusCompact]}
        >
          {device.connecting ? (
            <LoaderCircle size={16} strokeWidth={2} color={color} />
          ) : (
            <View style={[styles.statusDot, { backgroundColor: color }]} />
          )}
          <Text maxFontSizeMultiplier={1.3} style={styles.deviceMeta}>
            {device.label}
          </Text>
        </View>
        <MobileIconButton
          accessibilityLabel={`${device.host.name} 的更多操作`}
          icon={MoreHorizontal}
          onPress={props.onActions}
        />
      </View>
      <View style={styles.footerRow}>
        <Text maxFontSizeMultiplier={1.3} style={styles.deviceHint}>
          {device.current
            ? `连接方式：${props.path === 'relay' ? '安全中继' : props.path ? '直连' : '未确认'}`
            : device.connecting
              ? device.hint
              : device.connected
                ? '连接已建立'
                : device.lastPresenceAt != null
                  ? mobileDeviceLastConnectedLabel(device.lastPresenceAt, props.now, 'presence')
                  : mobileDeviceLastConnectedLabel(device.lastConnectedAt, props.now)}
        </Text>
        <PairingActionButton
          label={
            device.connecting || device.connected
              ? '连接详情'
              : device.requiresPairing
                ? '重新配对'
                : '重试'
          }
          accessibilityLabel={`${device.connecting || device.connected ? '查看详情' : device.requiresPairing ? '重新配对' : '重试连接'}：${device.host.name}`}
          icon={!device.connecting && !device.connected ? RefreshCw : undefined}
          loading={props.pending}
          variant="ghost"
          onPress={device.connecting || device.connected ? props.onDetails : props.onRetry}
          style={styles.textAction}
        />
      </View>
      {!device.connected && !device.connecting ? (
        <Text maxFontSizeMultiplier={1.3} style={styles.deviceMeta}>
          {device.hint}
        </Text>
      ) : null}
    </View>
  )
}
