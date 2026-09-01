import { ActivityIndicator, Modal, Platform, Pressable, Text, View } from 'react-native'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import { useMobileUpdate } from './use-mobile-update'

export function MobileUpdateObserver() {
  const theme = useMobileTheme()
  const { snapshot, install } = useMobileUpdate(true)
  const blocking =
    snapshot.mandatory &&
    ['available', 'downloading', 'ready-to-install', 'error'].includes(snapshot.state)
  if (!blocking) {
    return null
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: theme.spacing.space24,
          backgroundColor: theme.color.overlay
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: theme.size.overlayMaxWidth,
            alignSelf: 'center',
            gap: theme.spacing.space12,
            borderRadius: theme.radii.overlay,
            padding: theme.spacing.space20,
            backgroundColor: theme.color.bg.elevated
          }}
        >
          <Text style={[theme.typography.pageTitle, { color: theme.color.text.primary }]}>
            需要更新
          </Text>
          <Text style={[theme.typography.body, { color: theme.color.text.secondary }]}>
            此版本已停止支持，请更新后继续使用 HiveCode。
          </Text>
          {snapshot.version ? (
            <Text style={[theme.typography.caption, { color: theme.color.text.secondary }]}>
              版本 {snapshot.version} · 构建 {snapshot.buildNumber}
            </Text>
          ) : null}
          {snapshot.state === 'downloading' ? <ActivityIndicator /> : null}
          {snapshot.state === 'ready-to-install' ? (
            <Text style={[theme.typography.body, { color: theme.color.text.secondary }]}>
              请在系统安装器中完成安装；完成前无法继续使用。
            </Text>
          ) : null}
          {snapshot.state === 'error' ? (
            <Text style={[theme.typography.body, { color: theme.color.status.danger }]}>
              {snapshot.message}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Platform.OS === 'ios' ? '打开商店更新' : '下载并安装更新'}
            disabled={snapshot.state === 'downloading'}
            onPress={() => void install()}
            style={{
              minHeight: theme.size.minimumTouchTarget,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radii.control,
              backgroundColor: theme.color.brand.primary
            }}
          >
            <Text style={[theme.typography.label, { color: theme.color.text.inverse }]}>
              {snapshot.state === 'ready-to-install'
                ? '重新打开安装器'
                : Platform.OS === 'ios'
                  ? '打开商店更新'
                  : '下载并安装'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}
