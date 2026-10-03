import { View, Text, StyleSheet } from 'react-native'
import { SquareTerminal } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

// Empty detail pane shown beside the worktree-list sidebar on wide
// tablet/foldable layouts until the user opens a workspace.
export function WorkspaceDetailPlaceholder() {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)

  return (
    <View style={styles.container}>
      <View style={styles.icon}>
        <SquareTerminal size={24} color={theme.color.text.tertiary} strokeWidth={2} />
      </View>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
        No workspace open
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.body}>
        Pick a workspace from the sidebar to open its terminal here.
      </Text>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space24,
      backgroundColor: theme.color.bg.canvas
    },
    icon: {
      width: theme.spacing.space48,
      height: theme.spacing.space48,
      borderRadius: theme.radii.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface,
      marginBottom: theme.spacing.space16
    },
    title: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary,
      marginBottom: theme.spacing.space4,
      textAlign: 'center'
    },
    body: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      textAlign: 'center'
    }
  })
}
