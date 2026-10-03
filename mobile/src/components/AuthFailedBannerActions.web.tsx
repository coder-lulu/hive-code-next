import { Pressable, Text } from 'react-native'
import type { AuthFailedBannerActionProps } from './auth-failed-banner-styles'

// The page delegates re-pair to the shell; reconnect and removal belong to the native app.
export function AuthFailedBannerActions({ copy, styles, onRepair }: AuthFailedBannerActionProps) {
  return (
    <>
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

      <Text maxFontSizeMultiplier={1.3} style={styles.note}>
        Reconnect or remove this host from the HiveCode app.
      </Text>
    </>
  )
}
