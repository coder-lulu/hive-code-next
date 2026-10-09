import { Pressable, Text } from 'react-native'
import { Square } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createMobileNativeChatViewStyles } from './mobile-native-chat-view-styles'

/** The chat header's Stop. `held`: this phone's own Stop request is still in flight. */
export function MobileNativeChatStopButton({
  onStop,
  held
}: {
  onStop?: () => void
  held: boolean
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileNativeChatViewStyles)
  const label = held ? '正在停止…' : '停止'
  return (
    <Pressable
      style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
      onPress={onStop}
      disabled={held}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={held ? label : '停止 Agent'}
    >
      <Square
        size={theme.size.iconSmall}
        color={theme.color.status.danger}
        strokeWidth={theme.size.iconStrokeWidth}
        fill={theme.color.status.danger}
      />
      <Text style={styles.stopLabel}>{label}</Text>
    </Pressable>
  )
}
