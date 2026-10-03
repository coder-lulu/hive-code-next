import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'

export type BrowserPointerModifier = 'cmd' | 'ctrl' | 'alt' | 'shift'

const BROWSER_POINTER_MODIFIERS: { id: BrowserPointerModifier; label: string }[] = [
  { id: 'cmd', label: 'Cmd' },
  { id: 'ctrl', label: 'Ctrl' },
  { id: 'alt', label: 'Alt' },
  { id: 'shift', label: 'Shift' }
]

type Props = {
  disabled: boolean
  selectedModifiers: BrowserPointerModifier[]
  onToggle: (modifier: BrowserPointerModifier) => void
}

export function MobileBrowserPointerModifiers({
  disabled,
  selectedModifiers,
  onToggle
}: Props): React.JSX.Element {
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View style={styles.modifierRow}>
      {BROWSER_POINTER_MODIFIERS.map((modifier) => {
        const selected = selectedModifiers.includes(modifier.id)
        return (
          <Pressable
            key={modifier.id}
            style={({ pressed }) => [
              styles.keyButton,
              selected && styles.keyButtonSelected,
              pressed && !selected && styles.keyButtonPressed,
              disabled && styles.disabled
            ]}
            disabled={disabled}
            onPress={() => onToggle(modifier.id)}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`${modifier.label} click modifier`}
          >
            <Text
              style={[
                styles.keyButtonText,
                selected && styles.keyButtonTextSelected,
                disabled && styles.disabledText
              ]}
            >
              {modifier.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    modifierRow: {
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
    keyButtonSelected: {
      backgroundColor: theme.color.bg.selected
    },
    keyButtonText: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      fontWeight: '500'
    },
    keyButtonTextSelected: {
      color: theme.color.text.inverse
    },
    disabled: {
      opacity: 0.45
    },
    disabledText: {
      color: theme.color.text.tertiary
    }
  })
}
