import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../../theme/mobile-theme'
import { useMobileThemeStyles } from '../../theme/mobile-theme-provider'

export type MobileSegmentedControlOption<T extends string> = {
  accessibilityLabel?: string
  label: string
  value: T
}

export function MobileSegmentedControl<T extends string>(props: {
  accessibilityLabel: string
  disabled?: boolean
  onValueChange: (value: T) => void
  options: readonly [MobileSegmentedControlOption<T>, MobileSegmentedControlOption<T>]
  value: T
}) {
  const styles = useMobileThemeStyles(createStyles)
  const [focusedValue, setFocusedValue] = useState<T | null>(null)

  return (
    <View accessibilityLabel={props.accessibilityLabel} style={styles.control}>
      {props.options.map((option) => {
        const selected = option.value === props.value
        return (
          <Pressable
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityRole="tab"
            accessibilityState={{ disabled: props.disabled, selected }}
            disabled={props.disabled}
            key={option.value}
            onBlur={() => setFocusedValue(null)}
            onFocus={() => setFocusedValue(option.value)}
            onPress={() => props.onValueChange(option.value)}
            style={({ pressed }) => [
              styles.option,
              selected && styles.optionSelected,
              focusedValue === option.value && styles.optionFocused,
              pressed && styles.optionPressed,
              props.disabled && styles.disabled
            ]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    control: {
      minHeight: theme.size.minimumTouchTarget + theme.spacing.space8,
      flexDirection: 'row',
      padding: theme.spacing.space4,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    option: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderRadius: theme.radii.small
    },
    optionSelected: { backgroundColor: theme.color.bg.selected },
    optionFocused: { borderColor: theme.color.brand.primary, borderWidth: 1 },
    optionPressed: { opacity: 0.72 },
    disabled: { opacity: 0.4 },
    label: {
      ...theme.typography.label,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    labelSelected: { color: theme.color.text.inverse }
  })
}
