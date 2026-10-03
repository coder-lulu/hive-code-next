import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Delete } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

const BROWSER_KEYS = ['Enter', 'Backspace', 'Tab', 'Escape'] as const

type Props = {
  disabled: boolean
  onKeypress: (key: string) => void
}

export function MobileBrowserKeyRow({ disabled, onKeypress }: Props): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View style={styles.keyRow}>
      {BROWSER_KEYS.map((key) => (
        <Pressable
          key={key}
          style={({ pressed }) => [
            styles.keyButton,
            pressed && styles.keyButtonPressed,
            disabled && styles.disabled
          ]}
          disabled={disabled}
          onPress={() => onKeypress(key)}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          accessibilityLabel={`Send ${key} key to browser`}
        >
          {key === 'Backspace' ? (
            <Delete size={16} strokeWidth={2} color={theme.color.text.secondary} />
          ) : (
            <Text style={[styles.keyButtonText, disabled && styles.disabledText]}>
              {key === 'Escape' ? 'Esc' : key}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    keyRow: {
      flexDirection: 'row',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      paddingTop: theme.spacing.space8
    },
    keyButton: {
      minHeight: theme.size.minimumTouchTarget,
      minWidth: theme.size.minimumTouchTarget,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      paddingHorizontal: theme.spacing.space8
    },
    keyButtonPressed: {
      backgroundColor: theme.color.border.default
    },
    keyButtonText: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      fontWeight: '500'
    },
    disabled: {
      opacity: 0.45
    },
    disabledText: {
      color: theme.color.text.tertiary
    }
  })
}
