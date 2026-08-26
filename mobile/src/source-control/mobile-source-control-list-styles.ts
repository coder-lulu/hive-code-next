import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

// Changed-files list, section headers, file rows, and the commit bar. Split
// from the main source-control stylesheet to stay under the line limit.
export function createMobileSourceControlListStyles(theme: MobileTheme) {
  return StyleSheet.create({
    listContent: {
      paddingHorizontal: theme.spacing.space16,
      paddingBottom: theme.spacing.space64 * 2 + theme.spacing.space8
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: theme.spacing.space12,
      paddingBottom: theme.spacing.space4
    },
    sectionTitle: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      fontWeight: '600',
      textTransform: 'uppercase'
    },
    sectionCount: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      fontWeight: '600'
    },
    branchCompareBlock: {
      paddingBottom: theme.spacing.space8
    },
    branchSectionTitleBlock: {
      flex: 1,
      minWidth: 0
    },
    branchSectionSubtitle: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space4
    },
    branchStateRow: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingVertical: theme.spacing.space8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    branchStateText: {
      flex: 1,
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    fileRow: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingVertical: theme.spacing.space8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    fileRowPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    fileRowDisabled: {
      opacity: 0.78
    },
    fileRowUnavailable: {
      opacity: 0.72
    },
    statusBadge: {
      width: 24,
      alignItems: 'center'
    },
    statusBadgeText: {
      ...theme.typography.code,
      fontWeight: '600'
    },
    fileTextBlock: {
      flex: 1,
      minWidth: 0
    },
    filePath: {
      ...theme.typography.body,
      color: theme.color.text.primary
    },
    filePathDisabled: {
      color: theme.color.text.secondary
    },
    fileMeta: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space4
    },
    rowActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    iconButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      alignItems: 'center',
      justifyContent: 'center'
    },
    iconButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    iconButtonDisabled: {
      opacity: 0.45
    },
    commitBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      gap: theme.spacing.space4,
      padding: theme.spacing.space16,
      paddingTop: theme.spacing.space12,
      backgroundColor: theme.color.bg.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    commitRow: {
      flexDirection: 'row',
      gap: theme.spacing.space8
    },
    commitInput: {
      flex: 1,
      minHeight: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.canvas,
      color: theme.color.text.primary,
      paddingHorizontal: theme.spacing.space12,
      ...theme.typography.body
    },
    commitInputDisabled: {
      backgroundColor: theme.color.bg.subtle,
      borderColor: theme.color.border.default,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center'
    },
    commitInputDisabledText: {
      ...theme.typography.label,
      color: theme.color.text.tertiary,
      fontWeight: '600'
    },
    commitButton: {
      minWidth: 88,
      minHeight: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12
    },
    commitButtonSecondary: {
      backgroundColor: 'transparent',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default
    },
    generateButton: {
      width: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      alignItems: 'center',
      justifyContent: 'center'
    },
    commitButtonDisabled: {
      opacity: 0.45
    },
    commitButtonPressed: {
      opacity: 0.75
    },
    commitButtonText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    commitButtonSecondaryText: {
      color: theme.color.text.primary
    },
    commitFailurePanel: {
      marginTop: theme.spacing.space8,
      padding: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.status.danger,
      gap: theme.spacing.space8
    },
    commitFailureHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    commitFailureTextBlock: {
      flex: 1,
      minWidth: 0
    },
    commitFailureTitle: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    commitFailureSummary: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    commitFailureFixButton: {
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space4
    },
    commitFailureFixButtonDisabled: {
      opacity: 0.45
    },
    commitFailureFixButtonPressed: {
      opacity: 0.75
    },
    commitFailureFixButtonText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    commitFailureDetailsButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    commitFailureDetailsButtonPressed: {
      opacity: 0.75
    },
    commitFailureDetailsButtonText: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    commitFailureDetailsText: {
      ...theme.typography.code,
      color: theme.color.text.secondary
    },
    commitFailureLaunchError: {
      ...theme.typography.caption,
      color: theme.color.status.danger
    }
  })
}
