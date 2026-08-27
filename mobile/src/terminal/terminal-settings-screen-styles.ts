import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createTerminalSettingsScreenStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    scrollContent: {
      gap: theme.spacing.space24,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20
    },
    settingsGroup: {
      gap: theme.spacing.space8
    },
    groupHeading: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      paddingHorizontal: theme.spacing.space4
    },
    groupDescription: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      paddingHorizontal: theme.spacing.space4
    },
    emptyState: {
      minHeight: theme.size.groupedListRowMinHeight,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    emptyText: {
      ...theme.typography.body,
      color: theme.color.text.secondary
    }
  })
}
