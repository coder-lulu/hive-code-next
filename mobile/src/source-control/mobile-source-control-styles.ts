import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { createMobileSourceControlDiffStyles } from './mobile-source-control-diff-styles'
import { createMobileSourceControlListStyles } from './mobile-source-control-list-styles'

export function createMobileSourceControlStyles(theme: MobileTheme) {
  const baseStyles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    header: {
      backgroundColor: theme.color.bg.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    topBar: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space8
    },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: theme.spacing.space4
    },
    backButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    titleBlock: {
      flex: 1,
      minWidth: 0
    },
    title: {
      ...theme.typography.pageTitle,
      color: theme.color.text.primary
    },
    meta: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    refreshButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: theme.spacing.space4
    },
    refreshButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    refreshButtonDisabled: {
      opacity: 0.45
    },
    summaryCard: {
      margin: theme.spacing.space16,
      marginBottom: theme.spacing.space8,
      padding: theme.spacing.space16,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default
    },
    summaryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.space12
    },
    branchLine: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    branchText: {
      flex: 1,
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    syncText: {
      ...theme.typography.caption,
      color: theme.color.text.secondary
    },
    countRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.space12,
      marginTop: theme.spacing.space8
    },
    countText: {
      ...theme.typography.caption,
      color: theme.color.text.secondary
    },
    // Separate line under counts — keeps Abort inside the card on narrow phones.
    conflictRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space8,
      alignSelf: 'flex-start',
      maxWidth: '100%'
    },
    conflictText: {
      ...theme.typography.caption,
      color: theme.color.status.warning,
      textTransform: 'capitalize'
    },
    // Match bulk-action hit target so Abort reads as a real control, not a chip.
    abortButton: {
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.status.warning,
      backgroundColor: theme.color.bg.surface,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    },
    abortPressed: {
      opacity: 0.75
    },
    abortButtonDisabled: {
      opacity: 0.45
    },
    abortText: {
      ...theme.typography.label,
      color: theme.color.status.warning,
      fontWeight: '600',
      textTransform: 'capitalize'
    },
    reconnectBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      marginHorizontal: theme.spacing.space16,
      marginTop: theme.spacing.space16,
      marginBottom: -theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.status.warning
    },
    reconnectBannerText: {
      ...theme.typography.caption,
      color: theme.color.text.primary
    },
    actionError: {
      marginTop: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.status.danger
    },
    actionErrorText: {
      ...theme.typography.caption,
      color: theme.color.text.primary
    },
    bulkRow: {
      flexDirection: 'row',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space12
    },
    bulkButton: {
      flex: 1,
      minHeight: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: theme.spacing.space4
    },
    bulkMenuButton: {
      width: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      alignItems: 'center',
      justifyContent: 'center'
    },
    bulkButtonDisabled: {
      opacity: 0.45
    },
    bulkButtonPressed: {
      opacity: 0.75
    },
    bulkButtonText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    createPrBlock: {
      marginTop: theme.spacing.space12
    },
    createPrButton: {
      minHeight: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space12
    },
    createPrButtonDisabled: {
      backgroundColor: theme.color.bg.subtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default
    },
    createPrButtonPressed: {
      opacity: 0.78
    },
    createPrButtonText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    createPrButtonTextDisabled: {
      color: theme.color.text.secondary
    },
    createPrButtonHint: {
      ...theme.typography.caption,
      fontWeight: '600',
      textAlign: 'center',
      flexShrink: 1
    }
  })

  return {
    ...baseStyles,
    ...createMobileSourceControlListStyles(theme),
    ...createMobileSourceControlDiffStyles(theme)
  }
}
