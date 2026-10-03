import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../../theme/mobile-theme'
import { useMobileThemeStyles } from '../../theme/mobile-theme-provider'

export type MobileSegmentedControlOption<T extends string> = {
  accessibilityLabel?: string
  label: string
  value: T
  renderIcon?: (selected: boolean) => ReactNode
}

export function MobileSegmentedControl<T extends string>(props: {
  accessibilityLabel: string
  disabled?: boolean
  onValueChange: (value: T) => void
  options: readonly [MobileSegmentedControlOption<T>, MobileSegmentedControlOption<T>]
  value: T
  selectionStyle?: 'inverse' | 'surface'
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
              selected &&
                (props.selectionStyle === 'surface'
                  ? styles.optionSelectedSurface
                  : styles.optionSelected),
              focusedValue === option.value && styles.optionFocused,
              pressed && styles.optionPressed,
              props.disabled && styles.disabled
            ]}
          >
            {option.renderIcon?.(selected)}
            <Text
              maxFontSizeMultiplier={1.3}
              style={[
                styles.label,
                selected &&
                  (props.selectionStyle === 'surface'
                    ? styles.labelSelectedSurface
                    : styles.labelSelected)
              ]}
            >
              {option.label}
            </Text>
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
      flexDirection: 'row',
      gap: theme.spacing.space8,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderRadius: theme.radii.small
    },
    optionSelected: { backgroundColor: theme.color.bg.selected },
    optionSelectedSurface: {
      backgroundColor: theme.color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default
    },
    optionFocused: { borderColor: theme.color.brand.primary, borderWidth: 1 },
    optionPressed: { opacity: 0.72 },
    disabled: { opacity: 0.4 },
    label: {
      ...theme.typography.label,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    labelSelected: { color: theme.color.text.inverse },
    labelSelectedSurface: {
      color: theme.color.text.primary,
      fontWeight: theme.typography.sectionTitle.fontWeight
    }
  })
}
