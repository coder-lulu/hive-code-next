import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileLocalTaskStyles(theme: MobileTheme) {
  return StyleSheet.create({
    list: {
      paddingBottom: theme.spacing.space24
    },
    sectionHeader: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space12,
      paddingBottom: theme.spacing.space8,
      backgroundColor: theme.color.bg.canvas
    },
    sectionTitle: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary
    },
    sectionCount: {
      ...theme.typography.label,
      color: theme.color.text.tertiary
    },
    row: {
      minHeight: 88,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space12,
      backgroundColor: theme.color.bg.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    rowPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    statusIcon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    },
    main: {
      minWidth: 0,
      flex: 1,
      gap: theme.spacing.space4
    },
    titleRow: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space8
    },
    title: {
      ...theme.typography.body,
      flex: 1,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    status: {
      ...theme.typography.label,
      flexShrink: 0
    },
    statusWorkingText: {
      color: theme.color.brand.primary
    },
    statusAttentionText: {
      color: theme.color.status.warningText
    },
    statusDoneText: {
      color: theme.color.status.successText
    },
    statusUnverifiedText: {
      color: theme.color.status.warningText
    },
    metadata: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    metadataText: {
      ...theme.typography.meta,
      minWidth: 0,
      flexShrink: 1,
      color: theme.color.text.secondary
    },
    metadataSeparator: {
      ...theme.typography.meta,
      color: theme.color.text.tertiary
    },
    branchText: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary
    },
    notice: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      marginHorizontal: theme.spacing.space20,
      marginTop: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    noticeText: {
      ...theme.typography.meta,
      flex: 1,
      color: theme.color.status.warningText
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space32,
      paddingVertical: theme.spacing.space48
    },
    emptyIcon: {
      width: 64,
      height: 64,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.space4,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.subtle
    },
    stateTitle: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary,
      textAlign: 'center'
    },
    stateText: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    limitationText: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      textAlign: 'center'
    },
    footer: {
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space16
    },
    retryButton: {
      minHeight: theme.size.minimumTouchTarget,
      minWidth: 104,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    retryButtonPressed: {
      opacity: 0.78
    },
    retryText: {
      ...theme.typography.label,
      color: theme.color.text.inverse
    },
    runtimeButton: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16,
      borderRadius: theme.radii.control
    },
    runtimeButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    runtimeButtonText: {
      ...theme.typography.label,
      color: theme.color.brand.primary
    }
  })
}
