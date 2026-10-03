import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import { useMobileUpdate } from './use-mobile-update'
import { downloadPercent, updateIsBusy } from './mobile-update-presentation'

export function MobileUpdateObserver() {
  const theme = useMobileTheme()
  const insets = useSafeAreaInsets()
  const { snapshot, install, dismiss } = useMobileUpdate(true)
  if (!snapshot.artifact || (!snapshot.promptVisible && !snapshot.mandatory)) {
    return null
  }
  const busy = updateIsBusy(snapshot)
  const percent = downloadPercent(snapshot)
  const buttonLabel =
    snapshot.state === 'ready-to-install'
      ? Platform.OS === 'ios'
        ? '再次打开商店'
        : '打开安装器'
      : snapshot.state === 'awaiting-permission'
        ? '设置安装权限'
        : snapshot.state === 'downloading'
          ? '正在下载'
          : snapshot.state === 'opening-installer'
            ? '正在打开安装器'
            : snapshot.state === 'checking'
              ? '正在检查更新'
              : Platform.OS === 'ios'
                ? '打开商店更新'
                : '下载并安装'
  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          paddingLeft: Math.max(insets.left, theme.spacing.space20),
          paddingRight: Math.max(insets.right, theme.spacing.space20),
          paddingTop: Math.max(insets.top, theme.spacing.space24),
          paddingBottom: Math.max(insets.bottom, theme.spacing.space24),
          backgroundColor: theme.color.overlay
        }}
      >
        <ScrollView
          bounces={false}
          style={{
            flexGrow: 0,
            width: '100%',
            maxWidth: theme.size.overlayMaxWidth,
            alignSelf: 'center',
            borderRadius: theme.radii.overlay,
            backgroundColor: theme.color.bg.elevated
          }}
          contentContainerStyle={{
            padding: theme.spacing.space20,
            gap: theme.spacing.space12
          }}
        >
          <Text
            accessibilityRole="header"
            style={[theme.typography.pageTitle, { color: theme.color.text.primary }]}
          >
            {snapshot.mandatory ? '需要更新' : '发现新版本'}
          </Text>
          <Text style={[theme.typography.body, { color: theme.color.text.secondary }]}>
            {snapshot.mandatory
              ? '此版本已停止支持，请更新后继续使用 HiveCode。'
              : '有新版本可用，是否现在更新 HiveCode？'}
          </Text>
          <Text style={[theme.typography.caption, { color: theme.color.text.secondary }]}>
            版本 {snapshot.version} · 构建 {snapshot.buildNumber}
          </Text>
          {snapshot.state === 'available' && snapshot.message ? (
            <Text style={[theme.typography.body, { color: theme.color.text.secondary }]}>
              {snapshot.message}
            </Text>
          ) : null}
          {snapshot.state === 'downloading' ? (
            <View style={{ gap: theme.spacing.space8 }}>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel="更新下载进度"
                accessibilityValue={{ min: 0, max: 100, now: percent }}
                style={{
                  height: theme.spacing.space4,
                  borderRadius: theme.radii.small,
                  overflow: 'hidden',
                  backgroundColor: theme.color.bg.subtle
                }}
              >
                <View
                  style={{
                    height: '100%',
                    width: `${percent}%`,
                    backgroundColor: theme.color.bg.selected
                  }}
                />
              </View>
              <Text style={[theme.typography.caption, { color: theme.color.text.secondary }]}>
                {percent}% · {(snapshot.downloadedBytes / 1048576).toFixed(1)} /{' '}
                {(snapshot.totalBytes / 1048576).toFixed(1)} MB
              </Text>
              {percent === 100 ? (
                <Text style={[theme.typography.caption, { color: theme.color.text.secondary }]}>
                  正在校验安装包…
                </Text>
              ) : null}
            </View>
          ) : null}
          {snapshot.state === 'ready-to-install' ? (
            <Text style={[theme.typography.body, { color: theme.color.text.secondary }]}>
              {Platform.OS === 'ios'
                ? '请在商店中完成更新。'
                : '安装包已准备好，点击打开系统安装器完成更新，无需重复下载。'}
            </Text>
          ) : null}
          {['error', 'awaiting-permission'].includes(snapshot.state) ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                theme.typography.body,
                {
                  color:
                    snapshot.state === 'error'
                      ? theme.color.status.dangerText
                      : theme.color.text.secondary
                }
              ]}
            >
              {snapshot.message}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={buttonLabel}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => void install()}
            style={({ pressed }) => ({
              minHeight: theme.size.minimumTouchTarget,
              padding: theme.spacing.space12,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radii.control,
              backgroundColor:
                busy || pressed ? theme.color.text.secondary : theme.color.bg.selected
            })}
          >
            <Text style={[theme.typography.label, { color: theme.color.text.inverse }]}>
              {buttonLabel}
            </Text>
          </Pressable>
          {!snapshot.mandatory ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={snapshot.state === 'downloading' ? '后台下载' : '稍后更新'}
              onPress={dismiss}
              style={({ pressed }) => ({
                minHeight: theme.size.minimumTouchTarget,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: theme.radii.control,
                backgroundColor: pressed ? theme.color.bg.subtle : theme.color.bg.elevated
              })}
            >
              <Text style={[theme.typography.label, { color: theme.color.text.secondary }]}>
                {snapshot.state === 'downloading' ? '后台下载' : '稍后'}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  )
}
