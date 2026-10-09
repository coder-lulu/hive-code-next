import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronUp } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

/** A collapsed prompt above the usable composer; expanding gives it Send again. */
export function MobileNativeChatPromptStrip({
  title,
  onExpand
}: {
  title: string
  onExpand: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View testID="native-chat-prompt-strip" style={styles.strip}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="展开请求"
        accessibilityState={{ expanded: false }}
        hitSlop={8}
        style={styles.action}
        onPress={onExpand}
      >
        <ChevronUp size={16} color={theme.color.text.tertiary} />
      </Pressable>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    action: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    },
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingLeft: theme.spacing.space16,
      paddingRight: theme.spacing.space8,
      paddingVertical: theme.spacing.space4,
      backgroundColor: theme.color.bg.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    title: { flex: 1, color: theme.color.text.primary, ...theme.typography.body, fontWeight: '600' }
  })
}
