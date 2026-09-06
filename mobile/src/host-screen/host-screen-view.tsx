import { Alert, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MonitorOff } from 'lucide-react-native'
import {
  MobilePrimaryNavigation,
  type MobilePrimaryDestination
} from '../components/MobilePrimaryNavigation'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createHostScreenStyles } from './host-screen-styles'
import { HostScreenHeader } from './host-screen-header'
import { HostScreenOverlays } from './host-screen-overlays'
import { HostWorkspaceList } from './host-workspace-list'
import type { HostScreenController } from './use-host-screen-controller'

export function HostScreenView({ controller }: { controller: HostScreenController }) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createHostScreenStyles)
  function selectPrimaryDestination(destination: MobilePrimaryDestination) {
    if (destination === 'workspace') {
      return
    }
    if (destination === 'tasks') {
      controller.actions.leaveHost()
      return
    }
    const unavailableCopy = {
      agents: 'HiveAgent 角色与行业目录的数据契约尚未接入。',
      library: '资料库索引尚未接入当前 Runtime。',
      automation: '自动化编排服务尚未接入当前 Runtime。'
    }[destination]
    Alert.alert('功能接入中', unavailableCopy)
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <HostScreenHeader controller={controller} />
      {controller.state.error ? (
        <View accessibilityLiveRegion="polite" style={styles.missingRuntime}>
          <View style={styles.missingRuntimeIcon}>
            <MonitorOff color={theme.color.text.secondary} size={28} strokeWidth={1.8} />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.missingRuntimeTitle}>
            Runtime 不可用
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.missingRuntimeDescription}>
            此 Runtime 没有可用的移动连接。请选择其他 Runtime 或重新配对。
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              controller.embedded
                ? controller.actions.leaveHost()
                : controller.state.setShowRuntimeSelector(true)
            }
            style={({ pressed }) => [styles.missingRuntimeButton, pressed && styles.controlPressed]}
          >
            <Text maxFontSizeMultiplier={1.3} style={styles.missingRuntimeButtonText}>
              {controller.embedded ? '返回设备列表' : '选择其他 Runtime'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <HostWorkspaceList controller={controller} />
      )}
      {!controller.embedded ? (
        <MobilePrimaryNavigation
          active="workspace"
          bottomInset={controller.insets.bottom}
          onSelect={selectPrimaryDestination}
          theme={theme}
        />
      ) : null}
      <HostScreenOverlays controller={controller} />
    </SafeAreaView>
  )
}
