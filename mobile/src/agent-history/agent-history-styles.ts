import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createAgentHistoryStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.color.bg.canvas },
    header: { backgroundColor: theme.color.bg.canvas },
    topBar: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.circle
    },
    backButtonPressed: { backgroundColor: theme.color.bg.subtle },
    titleBlock: { flex: 1, marginHorizontal: theme.spacing.space8 },
    title: { ...theme.typography.pageTitle, color: theme.color.text.primary },
    meta: { ...theme.typography.caption, color: theme.color.text.secondary },
    refreshButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.circle
    },
    refreshButtonPressed: { backgroundColor: theme.color.bg.subtle },
    scopeTabs: {
      flexDirection: 'row',
      marginHorizontal: theme.spacing.space16,
      marginTop: theme.spacing.space12,
      padding: theme.spacing.space4,
      gap: theme.spacing.space4,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.subtle
    },
    scopeTab: {
      flex: 1,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    scopeTabActive: { backgroundColor: theme.color.bg.selected },
    scopeTabText: { ...theme.typography.label, color: theme.color.text.secondary },
    scopeTabTextActive: { color: theme.color.text.inverse, fontWeight: '600' },
    searchRow: {
      paddingHorizontal: theme.spacing.space16,
      paddingTop: theme.spacing.space12
    },
    searchInput: {
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      ...theme.typography.body
    },
    list: {
      paddingHorizontal: theme.spacing.space16,
      paddingTop: theme.spacing.space12,
      paddingBottom: theme.spacing.space24
    },
    groupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space4,
      paddingVertical: theme.spacing.space8,
      gap: theme.spacing.space8
    },
    groupHeaderText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    groupHeaderCount: { ...theme.typography.caption, color: theme.color.text.tertiary },
    card: {
      padding: theme.spacing.space16,
      marginBottom: theme.spacing.space8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    cardPressed: { backgroundColor: theme.color.bg.subtle },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space8 },
    cardTitle: {
      ...theme.typography.body,
      flex: 1,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    cardTimeAgo: { ...theme.typography.caption, color: theme.color.text.tertiary },
    cardLastMessage: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    cardMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space8
    },
    cardMetaText: { ...theme.typography.caption, color: theme.color.text.tertiary },
    currentBadge: {
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: 2,
      borderRadius: theme.radii.small,
      backgroundColor: theme.color.brand.subtle
    },
    currentBadgeText: {
      ...theme.typography.caption,
      color: theme.color.brand.primary,
      fontWeight: '600'
    },
    resumeButton: {
      minHeight: theme.size.minimumTouchTarget,
      minWidth: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 'auto',
      borderRadius: theme.radii.circle,
      backgroundColor: theme.color.bg.subtle
    },
    resumeButtonPressed: { opacity: 0.78 },
    resumeButtonDisabled: { opacity: 0.45 },
    preview: {
      marginTop: theme.spacing.space12,
      paddingTop: theme.spacing.space12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle,
      gap: theme.spacing.space8
    },
    previewTurn: { gap: 2 },
    previewRole: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      fontWeight: '600'
    },
    previewText: { ...theme.typography.meta, color: theme.color.text.secondary },
    noticeBanner: {
      marginHorizontal: theme.spacing.space16,
      marginTop: theme.spacing.space8,
      padding: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    noticeText: { ...theme.typography.meta, color: theme.color.status.warningText },
    resumeBanner: {
      marginHorizontal: theme.spacing.space16,
      marginTop: theme.spacing.space8,
      padding: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    resumeBannerText: { ...theme.typography.meta, color: theme.color.text.secondary },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space24,
      gap: theme.spacing.space8
    },
    stateTitle: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    stateText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    retryButton: {
      minHeight: theme.size.minimumTouchTarget,
      marginTop: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected,
      alignItems: 'center',
      justifyContent: 'center'
    },
    retryText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    }
  })
}
