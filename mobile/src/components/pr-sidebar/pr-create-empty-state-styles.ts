import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../../theme/mobile-theme'

export function createPrCreateEmptyStateStyles(theme: MobileTheme) {
  const colors = {
    bgBase: theme.color.text.inverse,
    bgPanel: theme.color.bg.surface,
    bgRaised: theme.color.bg.subtle,
    borderSubtle: theme.color.border.subtle,
    textPrimary: theme.color.text.primary,
    textSecondary: theme.color.text.secondary
  }
  const spacing = { xs: theme.spacing.space4, sm: theme.spacing.space8, md: theme.spacing.space12 }
  const radii = { button: theme.radii.control }
  const typography = {
    bodySize: theme.typography.label.fontSize,
    metaSize: theme.typography.caption.fontSize
  }

  return StyleSheet.create({
    section: {
      backgroundColor: colors.bgPanel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
      overflow: 'hidden'
    },
    header: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle
    },
    headerTitle: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs
    },
    headerLabel: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '600'
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs
    },
    createButton: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.textPrimary
    },
    createButtonDisabled: {
      opacity: 0.5
    },
    createButtonText: {
      color: colors.bgBase,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    iconButton: {
      minWidth: 32,
      minHeight: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button
    },
    iconButtonPressed: {
      backgroundColor: colors.bgRaised
    },
    body: {
      padding: spacing.md,
      gap: spacing.sm
    },
    bodyTitle: {
      color: colors.textPrimary,
      fontSize: typography.bodySize,
      fontWeight: '700'
    },
    bodyText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      lineHeight: 18
    },
    composerArea: {
      backgroundColor: colors.bgPanel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
      padding: spacing.md
    },
    // Secondary link-an-existing-PR affordance, set apart from the body copy.
    linkButton: {
      marginTop: spacing.xs,
      minHeight: 32,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs
    },
    linkButtonDisabled: {
      opacity: 0.5
    },
    linkButtonPressed: {
      opacity: 0.6
    },
    linkButtonText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontWeight: '600'
    }
  })
}
