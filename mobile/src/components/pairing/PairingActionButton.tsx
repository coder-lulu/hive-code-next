import type { LucideIcon } from 'lucide-react-native'
import { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
  type TextStyle
} from 'react-native'
import type { MobileTheme } from '../../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'

export function PairingActionButton(props: {
  accessibilityLabel?: string
  disabled?: boolean
  icon?: LucideIcon
  trailingIcon?: LucideIcon
  label: string
  loading?: boolean
  onPress: () => void
  style?: StyleProp<ViewStyle>
  labelStyle?: StyleProp<TextStyle>
  variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [focused, setFocused] = useState(false)
  const variant = props.variant ?? 'primary'
  const unavailable = Boolean(props.disabled || props.loading)
  const Icon = props.icon
  const TrailingIcon = props.trailingIcon
  const contentColor = variant === 'primary' ? theme.color.text.inverse : theme.color.text.primary

  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(props.loading), disabled: unavailable }}
      disabled={unavailable}
      onPress={props.onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && styles.pressed,
        unavailable && styles.disabled,
        props.style,
        focused && styles.focused
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={contentColor} size="small" />
      ) : Icon ? (
        <Icon color={contentColor} size={20} strokeWidth={2} />
      ) : null}
      <Text
        maxFontSizeMultiplier={1.3}
        style={[styles.label, variant === 'primary' && styles.primaryLabel, props.labelStyle]}
      >
        {props.label}
      </Text>
      {TrailingIcon ? <TrailingIcon color={contentColor} size={20} strokeWidth={2} /> : null}
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    button: {
      width: '100%',
      minHeight: theme.spacing.space48,
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
    focused: { borderWidth: 1, borderColor: theme.color.brand.primary },
    label: { ...theme.typography.label, color: theme.color.text.primary },
    primaryLabel: { color: theme.color.text.inverse }
  })
}
