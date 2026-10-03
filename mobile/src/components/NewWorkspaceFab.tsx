import { Pressable, StyleSheet } from 'react-native'
import { Plus } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'

type NewWorkspaceFabProps = {
  theme: MobileTheme
  onPress: () => void
  disabled?: boolean
}

// Phone-only floating "+" for creating a workspace. The parent list ends above
// primary navigation, so this offset only needs to clear workspace rows.
export function NewWorkspaceFab({
  theme,
  onPress,
  disabled
}: NewWorkspaceFabProps): React.JSX.Element {
  const styles = createStyles(theme)
  return (
    <Pressable
      style={({ pressed }) => [
        styles.fab,
        pressed && styles.fabPressed,
        disabled && styles.fabDisabled
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="新建工作区"
      hitSlop={8}
    >
      <Plus size={24} color={theme.color.text.inverse} strokeWidth={2.75} />
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    fab: {
      position: 'absolute',
      right: theme.spacing.space20,
      bottom: theme.spacing.space24,
      width: theme.size.floatingActionButtonSize,
      height: theme.size.floatingActionButtonSize,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.circle,
      backgroundColor: theme.color.bg.selected
    },
    fabPressed: { opacity: 0.74 },
    fabDisabled: { opacity: 0.4 }
  })
}
