import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'

/** A failed load: the message with its Retry button centered under it as one group. */
export function MobileLoadErrorState({
  message,
  onRetry
}: {
  message: string
  onRetry?: (() => void) | null
}) {
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View style={styles.state}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space12,
      padding: theme.spacing.space24
    },
    errorText: {
      color: theme.color.status.dangerText,
      ...theme.typography.body,
      textAlign: 'center'
    },
    retryButton: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      paddingHorizontal: theme.spacing.space16
    },
    retryText: {
      color: theme.color.text.primary,
      ...theme.typography.body,
      fontWeight: '600'
    }
  })
}
