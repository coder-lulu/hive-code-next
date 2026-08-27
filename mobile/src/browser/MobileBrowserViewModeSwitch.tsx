import { Pressable, StyleSheet, View } from 'react-native'
import { Monitor, Smartphone, type LucideIcon } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { MobileBrowserViewMode } from './browser-screencast-request'

type Props = {
  disabled: boolean
  value: MobileBrowserViewMode
  onChange: (mode: MobileBrowserViewMode) => void
}

const VIEW_MODES: { id: MobileBrowserViewMode; label: string; icon: LucideIcon }[] = [
  { id: 'web', label: 'Web', icon: Monitor },
  { id: 'mobile', label: 'Mobile', icon: Smartphone }
]

export function MobileBrowserViewModeSwitch({
  disabled,
  value,
  onChange
}: Props): React.JSX.Element {
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View style={styles.switch}>
      {VIEW_MODES.map((mode) => (
        <ViewModeButton
          key={mode.id}
          Icon={mode.icon}
          label={mode.label}
          selected={value === mode.id}
          disabled={disabled}
          onPress={() => onChange(mode.id)}
        />
      ))}
    </View>
  )
}

function ViewModeButton({
  Icon,
  disabled,
  label,
  onPress,
  selected
}: {
  Icon: LucideIcon
  disabled?: boolean
  label: string
  onPress: () => void
  selected: boolean
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        selected && styles.buttonSelected,
        pressed && !disabled && !selected && styles.buttonPressed,
        disabled && styles.disabled
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`Show ${label.toLowerCase()} website view`}
    >
      <Icon
        size={20}
        strokeWidth={2}
        color={selected ? theme.color.text.inverse : theme.color.text.secondary}
      />
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    switch: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      overflow: 'hidden',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    button: {
      minHeight: theme.size.minimumTouchTarget,
      width: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    buttonPressed: {
      backgroundColor: theme.color.border.default
    },
    buttonSelected: {
      backgroundColor: theme.color.bg.selected
    },
    disabled: {
      opacity: 0.45
    }
  })
}
