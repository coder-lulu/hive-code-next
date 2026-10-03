import type { LucideIcon } from 'lucide-react-native'
import { ActivityIndicator, Pressable, Text } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import type { createMobileLoginBottomSheetStyles } from './mobile-login-bottom-sheet-styles'

type MobileLoginActionButtonProps = {
  readonly busy: boolean
  readonly disabled?: boolean
  readonly icon: LucideIcon
  readonly label: string
  readonly onPress: () => void
  readonly styles: ReturnType<typeof createMobileLoginBottomSheetStyles>
  readonly theme: MobileTheme
  readonly variant: 'primary' | 'secondary'
}

export function MobileLoginActionButton({
  busy,
  disabled = false,
  icon: Icon,
  label,
  onPress,
  styles,
  theme,
  variant
}: MobileLoginActionButtonProps) {
  const unavailable = disabled || busy
  const foreground = variant === 'primary' ? theme.color.text.inverse : theme.color.text.primary
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variant === 'primary' ? styles.primaryButton : styles.secondaryButton,
        pressed && styles.actionPressed,
        unavailable && styles.actionDisabled
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : (
        <Icon color={foreground} size={20} strokeWidth={1.9} />
      )}
      <Text
        maxFontSizeMultiplier={1.3}
        style={variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel}
      >
        {label}
      </Text>
    </Pressable>
  )
}
