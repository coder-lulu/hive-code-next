import { Pressable, StyleSheet, View } from 'react-native'
import { SquareChevronRight } from 'lucide-react-native'

import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

type Props = {
  disabled: boolean
  onPress: () => void
}

export function QuickCommandsTabButton({ disabled, onPress }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <>
      <View style={styles.tabActionDivider} />
      <Pressable
        style={({ pressed }) => [
          styles.newTerminalButton,
          pressed && styles.newTerminalButtonPressed,
          disabled && styles.newTerminalButtonDisabled
        ]}
        disabled={disabled}
        onPress={onPress}
        accessibilityLabel="快捷命令"
      >
        <SquareChevronRight size={16} color={theme.color.text.secondary} strokeWidth={2} />
      </Pressable>
    </>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    tabActionDivider: {
      width: StyleSheet.hairlineWidth,
      height: theme.spacing.space20,
      backgroundColor: theme.color.border.subtle
    },
    newTerminalButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    newTerminalButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    newTerminalButtonDisabled: {
      opacity: 0.45
    }
  })
}
