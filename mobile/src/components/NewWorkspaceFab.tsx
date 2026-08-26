import { Pressable, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Plus } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'

// Diameter of the phone "new workspace" floating action button. Exported so the
// worktree list can reserve matching bottom padding and keep the last row tappable.
export const FAB_SIZE = 48

type NewWorkspaceFabProps = {
  theme: MobileTheme
  onPress: () => void
  disabled?: boolean
}

// Phone-only floating "+" for creating a workspace. Absolutely positioned so it
// never intercepts list row taps, and lifted above the home indicator.
export function NewWorkspaceFab({
  theme,
  onPress,
  disabled
}: NewWorkspaceFabProps): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const styles = createStyles(theme)
  return (
    <Pressable
      style={({ pressed }) => [
        styles.fab,
        { bottom: theme.spacing.space24 + insets.bottom },
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
      width: FAB_SIZE,
      height: FAB_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.circle,
      backgroundColor: theme.color.bg.selected,
      shadowColor: theme.color.text.primary,
      shadowOpacity: 0.2,
      shadowRadius: theme.spacing.space4,
      shadowOffset: { width: 0, height: theme.spacing.space4 },
      elevation: theme.spacing.space4
    },
    fabPressed: { opacity: 0.74 },
    fabDisabled: { opacity: 0.4 }
  })
}
