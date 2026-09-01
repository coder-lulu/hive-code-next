import { TriangleAlert } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

// Why: auth-failed is no longer necessarily terminal (issue #5200) — a
// transient rejection can latch it even though the desktop still lists this
// device. Offer Retry (fresh client + handshake) ahead of the disruptive
// re-pair flow so the common transient case recovers without re-pairing.
export function AuthFailedBanner({
  canRetry,
  onRetry,
  onRepair,
  onRemove
}: {
  canRetry: boolean
  onRetry: () => void
  onRepair: () => void
  onRemove?: () => void
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)

  return (
    <View style={styles.banner}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <TriangleAlert color={theme.color.status.danger} size={20} strokeWidth={2} />
      </View>
      <View style={styles.content}>
        <Text maxFontSizeMultiplier={1.3} style={styles.text}>
          Authentication failed — try reconnecting first; if it keeps failing, re-pair from desktop.
        </Text>
        <View style={styles.actions}>
          {canRetry ? (
            <Pressable
              accessibilityLabel="Retry authentication"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.action,
                styles.retryAction,
                pressed && styles.pressed
              ]}
              onPress={onRetry}
            >
              <Text maxFontSizeMultiplier={1.3} style={styles.retryText}>
                Retry
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="Re-pair this computer"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.action,
              styles.secondaryAction,
              pressed && styles.pressed
            ]}
            onPress={onRepair}
          >
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryText}>
              Re-pair
            </Text>
          </Pressable>
          {onRemove ? (
            <Pressable
              accessibilityLabel="Remove this computer"
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              onPress={onRemove}
            >
              <Text maxFontSizeMultiplier={1.3} style={styles.removeText}>
                Remove
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space12,
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    content: { flex: 1, minWidth: 0 },
    text: {
      ...theme.typography.meta,
      color: theme.color.status.danger
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space8
    },
    action: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderRadius: theme.radii.control
    },
    retryAction: { backgroundColor: theme.color.bg.selected },
    secondaryAction: {
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface
    },
    pressed: { opacity: 0.72 },
    retryText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    secondaryText: {
      ...theme.typography.label,
      color: theme.color.text.primary
    },
    removeText: {
      ...theme.typography.label,
      color: theme.color.status.danger
    }
  })
}
