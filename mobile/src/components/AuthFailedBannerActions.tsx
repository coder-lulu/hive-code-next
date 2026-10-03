import { Pressable, Text } from 'react-native'
import type { AuthFailedBannerActionProps } from './auth-failed-banner-styles'

export function AuthFailedBannerActions({
  canRetry,
  copy,
  styles,
  onRetry,
  onRepair,
  onRemove
}: AuthFailedBannerActionProps) {
  return (
    <>
      {canRetry ? (
        <Pressable
          accessibilityLabel={copy.retryAccessibility}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, styles.retryAction, pressed && styles.pressed]}
          onPress={onRetry}
        >
          <Text maxFontSizeMultiplier={1.3} style={styles.retryText}>
            {copy.retry}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel={copy.repairAccessibility}
        accessibilityRole="button"
        style={({ pressed }) => [styles.action, styles.secondaryAction, pressed && styles.pressed]}
        onPress={onRepair}
      >
        <Text maxFontSizeMultiplier={1.3} style={styles.secondaryText}>
          {copy.repair}
        </Text>
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityLabel={copy.removeAccessibility}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          onPress={onRemove}
        >
          <Text maxFontSizeMultiplier={1.3} style={styles.removeText}>
            {copy.remove}
          </Text>
        </Pressable>
      ) : null}
    </>
  )
}
