import type { ComponentType } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

type HeaderIconProps = {
  size?: number
  color?: string
  strokeWidth?: number
}

type MobileSessionHeaderIconButtonProps = {
  active?: boolean
  accessibilityLabel: string
  icon: ComponentType<HeaderIconProps>
  onPress: () => void
}

export function MobileSessionHeaderIconButton({
  active = false,
  accessibilityLabel,
  icon: Icon,
  onPress
}: MobileSessionHeaderIconButtonProps) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        active && styles.buttonActive,
        pressed && styles.buttonPressed
      ]}
      onPress={onPress}
      hitSlop={theme.spacing.space4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
    >
      <Icon
        size={theme.spacing.space20}
        color={active ? theme.color.text.inverse : theme.color.text.secondary}
        strokeWidth={2}
      />
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    button: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: theme.spacing.space4,
      borderRadius: theme.radii.control
    },
    buttonActive: { backgroundColor: theme.color.bg.selected },
    buttonPressed: { opacity: 0.72 }
  })
}
