import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { createMobileTaskCompatColors } from './mobile-task-screen-colors'

export function createMobileTaskScreenChromeStyles(theme: MobileTheme) {
  const colors = createMobileTaskCompatColors(theme)
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bgBase },
    topChrome: {
      backgroundColor: colors.bgPanel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle
    },
    statusBar: {
      minHeight: theme.size.navigationBarHeight,
      paddingHorizontal: theme.spacing.space20,
      flexDirection: 'row',
      alignItems: 'center'
    },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    },
    titleWrap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
    title: { ...theme.typography.pageTitle, color: colors.textPrimary },
    iconButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    },
    toolbar: {
      minHeight: theme.size.minimumTouchTarget + theme.spacing.space12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space8
    },
    toolbarScroll: { maxHeight: theme.size.minimumTouchTarget + theme.spacing.space12 },
    segmentButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    segmentIconButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    segmentCountPill: {
      minWidth: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space8,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    segmentRepoDot: {
      width: theme.spacing.space8,
      height: theme.spacing.space8,
      borderRadius: theme.radii.small
    },
    segmentButtonText: {
      ...theme.typography.meta,
      color: colors.textPrimary,
      fontWeight: theme.typography.label.fontWeight
    },
    segmentSecondaryText: { ...theme.typography.meta, color: colors.textSecondary },
    searchBar: {
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderSubtle
    },
    errorBanner: {
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space12,
      backgroundColor: colors.bgPanel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle
    },
    errorText: { ...theme.typography.meta, color: colors.statusRed },
    sourceErrorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space12,
      backgroundColor: colors.bgPanel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle
    },
    sourceErrorCopy: { flex: 1, minWidth: 0 },
    sourceErrorText: {
      ...theme.typography.meta,
      color: colors.statusAmber,
      fontWeight: theme.typography.sectionTitle.fontWeight
    },
    sourceErrorSlug: { ...theme.typography.code, color: colors.textPrimary },
    sourceErrorMessage: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space4,
      color: colors.textSecondary
    },
    sourceErrorRetry: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: theme.radii.control
    },
    sourceErrorRetryText: {
      ...theme.typography.label,
      color: colors.textPrimary
    },
    sourceNoticeBanner: {
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space12,
      backgroundColor: colors.bgPanel,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle
    },
    sourceNoticeText: { ...theme.typography.meta, color: colors.statusAmber },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { ...theme.typography.body, color: colors.textSecondary },
    centeredHint: {
      ...theme.typography.caption,
      maxWidth: '80%',
      marginTop: theme.spacing.space8,
      color: colors.textMuted,
      textAlign: 'center'
    },
    centerActionButton: {
      minWidth: theme.spacing.space64 * 2,
      marginTop: theme.spacing.space12
    }
  })
}
