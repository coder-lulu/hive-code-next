import type { LucideIcon } from 'lucide-react-native'
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'
import type { MobileTheme } from '../../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'

export function PairingActionButton(props: {
  accessibilityLabel?: string
  disabled?: boolean
  icon?: LucideIcon
  label: string
  loading?: boolean
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const variant = props.variant ?? 'primary'
  const unavailable = Boolean(props.disabled || props.loading)
  const Icon = props.icon
  const contentColor = variant === 'primary' ? theme.color.text.inverse : theme.color.text.primary

  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(props.loading), disabled: unavailable }}
      disabled={unavailable}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && styles.pressed,
        unavailable && styles.disabled
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={contentColor} size="small" />
      ) : Icon ? (
        <Icon color={contentColor} size={20} strokeWidth={2} />
      ) : null}
      <Text style={[styles.label, variant === 'primary' && styles.primaryLabel]}>
        {props.label}
      </Text>
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    button: {
      width: '100%',
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space12,
      borderRadius: theme.radii.control
    },
    primary: {
      backgroundColor: theme.color.bg.selected,
      borderColor: theme.color.bg.selected,
      borderWidth: 1
    },
    secondary: {
      backgroundColor: theme.color.bg.surface,
      borderColor: theme.color.border.default,
      borderWidth: 1
    },
    ghost: { backgroundColor: theme.color.bg.canvas },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.4 },
    label: { ...theme.typography.label, color: theme.color.text.primary },
    primaryLabel: { color: theme.color.text.inverse }
  })
}
