import type { LucideIcon } from 'lucide-react-native'
import { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle
} from 'react-native'
import type { MobileTheme } from '../../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'

type MobileIconButtonTone = 'default' | 'brand' | 'danger'

export type MobileIconButtonProps = Omit<
  PressableProps,
  'accessibilityLabel' | 'children' | 'style'
> & {
  accessibilityLabel: string
  icon: LucideIcon
  iconSize?: 16 | 20 | 24
  loading?: boolean
  selected?: boolean
  style?: StyleProp<ViewStyle>
  tone?: MobileIconButtonTone
}

export function MobileIconButton({
  accessibilityLabel,
  disabled,
  icon: Icon,
  iconSize = 20,
  loading = false,
  onBlur,
  onFocus,
  selected = false,
  style,
  tone = 'default',
  ...pressableProps
}: MobileIconButtonProps) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [focused, setFocused] = useState(false)
  const unavailable = disabled || loading
  const iconColor = selected
    ? theme.color.text.inverse
    : tone === 'brand'
      ? theme.color.brand.primary
      : tone === 'danger'
        ? theme.color.status.danger
        : theme.color.text.secondary

  return (
    <Pressable
      {...pressableProps}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, selected }}
      disabled={unavailable}
      onBlur={(event) => {
        setFocused(false)
        onBlur?.(event)
      }}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      style={({ pressed }) => [
        styles.button,
        selected && styles.selected,
        focused && styles.focused,
        pressed && styles.pressed,
        unavailable && styles.disabled,
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator color={iconColor} size="small" />
      ) : (
        <Icon color={iconColor} size={iconSize} strokeWidth={2} />
      )}
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    button: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      alignItems: 'center',
      justifyContent: 'center'
    },
    selected: { backgroundColor: theme.color.bg.selected },
    focused: { borderColor: theme.color.brand.primary, borderWidth: 1 },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.4 }
  })
}
