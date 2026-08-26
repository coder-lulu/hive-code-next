import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../../theme/mobile-theme'

// Styles for the "Fix checks with AI" / "Resolve conflicts with AI" triage
// affordances. Kept in their own focused file (rather than growing the shared
// sidebar/conflict style sheets) and muted/monochrome to match the sidebar.
export function createPrAiTriageStyles(theme: MobileTheme) {
  const colors = {
    bgRaised: theme.color.bg.subtle,
    borderSubtle: theme.color.border.default,
    textPrimary: theme.color.text.primary,
    textSecondary: theme.color.text.secondary,
    statusRed: theme.color.status.danger,
    diffDeletedBg: theme.color.bg.surface
  }
  const spacing = { xs: theme.spacing.space4, sm: theme.spacing.space8, md: theme.spacing.space12 }
  const radii = { button: theme.radii.control }
  const typography = {
    bodySize: theme.typography.label.fontSize,
    metaSize: theme.typography.caption.fontSize
  }

  return StyleSheet.create({
    triageArea: {
      gap: spacing.xs
    },
    // Top-of-section triage strip (desktop PRTriageStrip): failing-count summary +
    // a Fix action on the right, tinted by the failure status color.
    triageStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: radii.button,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.statusRed,
      backgroundColor: colors.diffDeletedBg
    },
    triageStripText: {
      flex: 1,
      minWidth: 0
    },
    triageStripTitle: {
      color: colors.textPrimary,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    triageStripSubtitle: {
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    // Compact Fix button sitting inside the strip (vs. the full-width footer button).
    triageStripButton: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.button,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.bgRaised
    },
    triageStripButtonText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    triageButton: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radii.button,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.bgRaised
    },
    triageButtonPressed: {
      opacity: 0.7
    },
    triageButtonText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    triageError: {
      color: colors.statusRed,
      fontSize: typography.metaSize
    }
  })
}
