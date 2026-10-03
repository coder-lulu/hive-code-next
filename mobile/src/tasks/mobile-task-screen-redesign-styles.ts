import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { createMobileTaskScreenPalette } from './mobile-task-screen-colors'

export function createMobileTaskScreenRedesignStyles(theme: MobileTheme) {
  const palette = createMobileTaskScreenPalette(theme)
  return StyleSheet.create({
    headerCreateButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space8,
      borderRadius: theme.radii.control
    },
    headerCreateButtonText: {
      ...theme.typography.label,
      color: palette.brand,
      fontWeight: theme.typography.sectionTitle.fontWeight
    },
    headerRefreshButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    runtimeButton: {
      minWidth: 0,
      maxWidth: '100%',
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space4,
      borderRadius: theme.radii.control
    },
    runtimeStatusDot: {
      width: theme.spacing.space8,
      height: theme.spacing.space8,
      flexShrink: 0,
      borderRadius: theme.radii.circle
    },
    runtimeName: {
      ...theme.typography.caption,
      minWidth: 0,
      flexShrink: 1,
      color: palette.textPrimary,
      fontWeight: theme.typography.sectionTitle.fontWeight
    },
    emptyIcon: {
      width: theme.spacing.space64,
      height: theme.spacing.space64,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.space16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.borderDefault,
      borderRadius: theme.radii.card,
      backgroundColor: palette.surface
    },
    emptyTitle: {
      ...theme.typography.sectionTitle,
      color: palette.textPrimary,
      textAlign: 'center'
    },
    emptyDescription: {
      ...theme.typography.body,
      maxWidth: '86%',
      marginTop: theme.spacing.space8,
      color: palette.textSecondary,
      textAlign: 'center'
    },
    emptyPrimaryButton: {
      minWidth: theme.spacing.space64 * 2,
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space20,
      paddingHorizontal: theme.spacing.space20,
      borderRadius: theme.radii.control,
      backgroundColor: palette.selected
    },
    emptyPrimaryButtonPressed: { opacity: 0.76 },
    emptyPrimaryButtonDisabled: { opacity: 0.45 },
    emptyPrimaryButtonText: {
      ...theme.typography.label,
      color: palette.textInverse,
      fontWeight: theme.typography.sectionTitle.fontWeight
    },
    emptySecondaryButton: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      marginTop: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12
    },
    emptySecondaryButtonText: { ...theme.typography.label, color: palette.brand }
  })
}
