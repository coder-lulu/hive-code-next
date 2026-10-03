import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Info, X } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

/**
 * One dismissible line above the list, in two tones.
 *
 * `notice` is the default and stays monochrome: the host is healthy and the user's target simply
 * went away. `failure` is for an action that did not happen, which the list has to say without
 * taking the screen: color is for state, so it is one red rule and nothing else.
 *
 * Both are inserted into a screen that is already on screen, so a reader who has moved past the top
 * of the list never arrives at one. The tone decides how loudly it is carried to them: a refusal
 * interrupts, and a bounced route waits its turn, because interrupting for the second would train
 * people to ignore the first. `alert` only for the refusal, and no role for the other — React
 * Native has no `status` role, so the polite region is the whole of that answer.
 */
export function HostRouteNoticeBanner({
  message,
  tone = 'notice',
  onDismiss
}: {
  message: string
  tone?: 'notice' | 'failure'
  onDismiss: () => void
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)

  return (
    <View
      style={[styles.banner, tone === 'failure' && styles.failure]}
      accessibilityRole={tone === 'failure' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'failure' ? 'assertive' : 'polite'}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Info
          color={tone === 'failure' ? theme.color.status.dangerText : theme.color.text.secondary}
          size={20}
          strokeWidth={2}
        />
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
    failure: {
      borderBottomColor: theme.color.status.danger
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
