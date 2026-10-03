import { Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MonitorOff } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createHostScreenStyles } from './host-screen-styles'
import { HostScreenHeader } from './host-screen-header'
import { HostScreenOverlays } from './host-screen-overlays'
import { HostWorkspaceList } from './host-workspace-list'
import type { HostScreenController } from './use-host-screen-controller'

export function HostScreenView({ controller }: { controller: HostScreenController }) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createHostScreenStyles)
  return (
    <SafeAreaView
      style={styles.container}
      edges={controller.embedded ? ['top'] : ['top', 'bottom']}
    >
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
      <HostScreenOverlays controller={controller} />
    </SafeAreaView>
  )
}
