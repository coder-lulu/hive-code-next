import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createFileExplorerStyles(theme: MobileTheme) {
  return StyleSheet.create({
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
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space12
    },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
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
      marginTop: theme.spacing.space4,
      color: theme.color.text.secondary
    },
    list: { flex: 1 },
    listContent: {
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12
    },
    row: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingRight: theme.spacing.space16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    rowPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    rowDisabled: {
      opacity: 0.58
    },
    chevronSpacer: {
      width: 16
    },
    rowTextBlock: {
      flex: 1,
      minWidth: 0
    },
    rowTitle: {
      ...theme.typography.body,
      color: theme.color.text.primary
    },
    rowTitleDisabled: {
      color: theme.color.text.tertiary
    },
    rowMeta: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space4,
      color: theme.color.text.tertiary
    },
    inlineStatusRow: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingRight: theme.spacing.space16,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    inlineStatusText: {
      ...theme.typography.caption,
      color: theme.color.text.secondary
    },
    inlineErrorText: {
      ...theme.typography.caption,
      flex: 1,
      minWidth: 0,
      color: theme.color.status.danger
    },
    inlineRetryButton: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      paddingHorizontal: theme.spacing.space12
    },
    inlineRetryText: {
      ...theme.typography.label,
      color: theme.color.text.primary
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space12,
      padding: theme.spacing.space24
    },
    emptyText: {
      ...theme.typography.body,
      color: theme.color.text.secondary
    },
    errorText: {
      ...theme.typography.body,
      color: theme.color.status.danger,
      textAlign: 'center'
    },
    retryButton: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      paddingHorizontal: theme.spacing.space16
    },
    retryText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    }
  })
}
