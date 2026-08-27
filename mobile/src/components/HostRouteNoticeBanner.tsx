import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Info, X } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

// Informational, not an error: the host is healthy and the user's target simply went away,
// so this stays monochrome rather than borrowing the auth-failed red.
export function HostRouteNoticeBanner({
  message,
  onDismiss
}: {
  message: string
  onDismiss: () => void
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)

  return (
    <View style={styles.banner}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Info color={theme.color.text.secondary} size={20} strokeWidth={2} />
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.text}>
        {message}
      </Text>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notice"
        hitSlop={theme.spacing.space8}
        style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
      >
        <X size={20} color={theme.color.text.secondary} strokeWidth={2} />
      </Pressable>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      minHeight: theme.size.groupedListRowMinHeight,
      paddingLeft: theme.spacing.space20,
      paddingRight: theme.spacing.space8,
      paddingVertical: theme.spacing.space8,
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    text: {
      ...theme.typography.meta,
      flex: 1,
      color: theme.color.text.secondary
    },
    dismiss: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    pressed: { backgroundColor: theme.color.bg.subtle }
  })
}
