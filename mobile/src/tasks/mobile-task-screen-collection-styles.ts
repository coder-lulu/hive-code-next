import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { createMobileTaskScreenPalette } from './mobile-task-screen-colors'

export function createMobileTaskScreenCollectionStyles(theme: MobileTheme) {
  const palette = createMobileTaskScreenPalette(theme)
  return StyleSheet.create({
    paginationFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      paddingTop: theme.spacing.space12,
      paddingBottom: theme.spacing.space8,
      backgroundColor: palette.surface
    },
    paginationButton: {
      width: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.space8,
      borderWidth: 1,
      backgroundColor: palette.subtle,
      borderColor: palette.borderDefault,
      borderRadius: theme.radii.control
    },
    boardContainer: {
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space8,
      paddingBottom: theme.spacing.space12
    },
    boardColumn: {
      width: 280,
      maxHeight: '100%',
      overflow: 'hidden',
      borderWidth: 1,
      backgroundColor: palette.surface,
      borderColor: palette.borderDefault,
      borderRadius: theme.radii.card
    },
    boardCard: {
      margin: theme.spacing.space8,
      marginBottom: 0,
      padding: theme.spacing.space12,
      borderWidth: 1,
      backgroundColor: palette.canvas,
      borderColor: palette.borderSubtle,
      borderRadius: theme.radii.control
    }
  })
}
