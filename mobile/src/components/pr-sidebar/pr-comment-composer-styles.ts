import { StyleSheet } from 'react-native'
import { TEXT_INPUT_FONT_SIZE } from '../../platform/text-input-font-size'
import type { MobileTheme } from '../../theme/mobile-theme'

// Styles for the plain-text reply / root-comment composer. Muted/monochrome to
// match the PR comment timeline; split out to keep PRCommentComposer focused.
export function createPrCommentComposerStyles(theme: MobileTheme) {
  const colors = {
    bgBase: theme.color.text.inverse,
    bgRaised: theme.color.bg.subtle,
    borderSubtle: theme.color.border.default,
    textPrimary: theme.color.text.primary,
    textSecondary: theme.color.text.secondary,
    statusRed: theme.color.status.dangerText
  }
  const spacing = { sm: theme.spacing.space8, md: theme.spacing.space12 }
  const radii = { button: theme.radii.control, input: theme.radii.control }
  const typography = {
    bodySize: theme.typography.label.fontSize,
    metaSize: theme.typography.caption.fontSize
  }

  return StyleSheet.create({
    container: {
      // Input → Cancel/Save needs clear separation (title edit was flush without this).
      gap: spacing.md
    },
    input: {
      minHeight: 64,
      backgroundColor: colors.bgRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      borderRadius: radii.input,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.textPrimary,
      fontSize: TEXT_INPUT_FONT_SIZE,
      textAlignVertical: 'top'
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm
    },
    cancel: {
      minHeight: 36,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button
    },
    cancelText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontWeight: '600'
    },
    submit: {
      minHeight: 36,
      minWidth: 72,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button,
      backgroundColor: colors.textPrimary
    },
    submitDisabled: {
      opacity: 0.45
    },
    submitText: {
      color: colors.bgBase,
      fontSize: typography.metaSize,
      fontWeight: '700'
    },
    pressed: {
      opacity: 0.8
    },
    error: {
      color: colors.statusRed,
      fontSize: typography.metaSize
    }
  })
}
