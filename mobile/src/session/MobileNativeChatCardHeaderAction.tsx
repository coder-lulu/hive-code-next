import { Keyboard, Pressable, StyleSheet } from 'react-native'
import { ChevronDown, X } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

/** A prompt card's header action: Cancel where the lane can cancel, else a Collapse that writes nothing. */
export function MobileNativeChatCardHeaderAction<Prompt>({
  prompt,
  onCancel,
  onCollapse,
  disabled
}: {
  prompt?: Prompt
  onCancel?: (prompt?: Prompt) => Promise<boolean>
  onCollapse?: () => void
  disabled?: boolean
}): React.JSX.Element | null {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  if (!onCancel && !onCollapse) {
    return null
  }
  const Icon = onCancel ? X : ChevronDown
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={onCancel ? '取消请求' : '收起请求'}
      accessibilityState={onCancel ? undefined : { expanded: true }}
      hitSlop={8}
      style={styles.action}
      onPress={() => {
        if (onCancel) {
          void onCancel(prompt)
          return
        }
        // Why: a reply field hidden by the collapse must not keep the keyboard up.
        Keyboard.dismiss()
        onCollapse?.()
      }}
      disabled={disabled}
    >
      <Icon size={16} color={theme.color.text.tertiary} />
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    action: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    }
  })
}
