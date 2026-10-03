import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileSessionsStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      width: '100%',
      alignSelf: 'center',
      paddingHorizontal: theme.spacing.space20
    },
    heading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingTop: theme.spacing.space24
    },
    title: { ...theme.typography.display, color: theme.color.text.primary, flex: 1, minWidth: 0 },
    newSession: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space8,
      borderRadius: theme.radii.control
    },
    actionLabel: { ...theme.typography.label, color: theme.color.text.secondary },
    iconButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    disabled: { opacity: 0.45 },
    pressed: { backgroundColor: theme.color.bg.subtle },
    search: {
      ...theme.typography.body,
      minHeight: theme.size.minimumTouchTarget,
      marginTop: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary
    },
    filters: { flexDirection: 'row', gap: theme.spacing.space12, marginTop: theme.spacing.space16 },
    filter: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space4,
      paddingBottom: theme.spacing.space8,
      borderBottomWidth: theme.size.activeIndicatorHeight,
      borderBottomColor: 'transparent'
    },
    filterSelected: { borderBottomColor: theme.color.text.primary },
    filterLabel: { ...theme.typography.label, color: theme.color.text.secondary },
    filterLabelSelected: {
      color: theme.color.text.primary,
      fontWeight: theme.typography.sectionTitle.fontWeight
    },
    list: { flex: 1 },
    listContent: { flexGrow: 1, paddingBottom: theme.spacing.space24 },
    sectionTitle: {
      ...theme.typography.label,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space24,
      marginBottom: theme.spacing.space8
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      paddingVertical: theme.spacing.space40
    },
    emptyTitle: { ...theme.typography.sectionTitle, color: theme.color.text.secondary },
    emptyBody: { ...theme.typography.meta, color: theme.color.text.secondary, textAlign: 'center' },
    retry: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      backgroundColor: theme.color.bg.surface
    },
    firstRow: { borderTopLeftRadius: theme.radii.card, borderTopRightRadius: theme.radii.card },
    lastRow: {
      borderBottomLeftRadius: theme.radii.card,
      borderBottomRightRadius: theme.radii.card
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    recentRow: { backgroundColor: theme.color.bg.canvas },
    rowMain: {
      flex: 1,
      minWidth: 0,
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      gap: theme.spacing.space12
    },
    rowCopy: { flex: 1, minWidth: 0, gap: theme.spacing.space4 },
    rowTitle: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    metadata: { ...theme.typography.meta, color: theme.color.text.secondary },
    branchLine: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    branchInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      maxWidth: '100%',
      minWidth: 0,
      flexShrink: 1
    },
    branch: {
      ...theme.typography.code,
      color: theme.color.text.secondary,
      maxWidth: '100%',
      flexShrink: 1,
      minWidth: 0
    },
    recentLabel: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.small,
      paddingHorizontal: theme.spacing.space4,
      paddingVertical: theme.spacing.space4
    },
    rowAside: { alignItems: 'flex-end', gap: theme.spacing.space16, maxWidth: '34%' },
    status: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space4 },
    attentionStatus: {
      backgroundColor: theme.color.status.warningSubtle,
      borderRadius: theme.radii.small,
      paddingHorizontal: theme.spacing.space4,
      paddingVertical: theme.spacing.space4
    },
    statusLabel: { ...theme.typography.meta },
    timestamp: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      textAlign: 'right'
    },
    continueButton: {
      minHeight: theme.size.minimumTouchTarget,
      minWidth: theme.spacing.space64,
      paddingHorizontal: theme.spacing.space16,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    continueLabel: { ...theme.typography.label, color: theme.color.text.inverse }
  })
}
