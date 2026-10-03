import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import type { ReactNode } from 'react'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'

type Props = {
  children: ReactNode
  disabled?: boolean
  label: string
  onPress: () => void
  style?: StyleProp<ViewStyle>
}

export function MobileBrowserToolbarIconButton({
  children,
  disabled,
  label,
  onPress,
  style
}: Props): React.JSX.Element {
  const styles = useMobileThemeStyles(createStyles)
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        style,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.disabled
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      {children}
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
    buttonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    disabled: {
      opacity: 0.45
    }
  })
}
