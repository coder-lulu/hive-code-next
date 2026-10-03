import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileRuntimeSelectorStyles(theme: MobileTheme) {
  return StyleSheet.create({
    header: {
      minHeight: theme.spacing.space64,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space12,
      paddingBottom: theme.spacing.space20
    },
    headerCopy: { minWidth: 0, flex: 1, gap: theme.spacing.space4 },
    title: { ...theme.typography.pageTitle, color: theme.color.text.primary },
    description: { ...theme.typography.meta, color: theme.color.text.secondary },
    closeButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    pressed: { backgroundColor: theme.color.bg.subtle },
    disabled: { opacity: 0.55 },
    section: { gap: theme.spacing.space8, marginBottom: theme.spacing.space20 },
    sectionTitle: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    group: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: theme.spacing.space64,
      backgroundColor: theme.color.border.subtle
    },
    row: {
      minHeight: theme.spacing.space64 + theme.spacing.space16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12
    },
    rowSelected: { backgroundColor: theme.color.bg.subtle },
    runtimeIcon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    rowCopy: { minWidth: 0, flex: 1, gap: theme.spacing.space4 },
    rowTitle: { ...theme.typography.body, color: theme.color.text.primary, fontWeight: '600' },
    rowDetail: { ...theme.typography.caption, color: theme.color.text.secondary },
    status: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space4 },
    statusDot: {
      width: theme.spacing.space8,
      height: theme.spacing.space8,
      borderRadius: theme.radii.circle
    },
    statusText: { ...theme.typography.caption, fontWeight: '500' },
    selectionError: {
      ...theme.typography.meta,
      marginBottom: theme.spacing.space12,
      color: theme.color.text.secondary
    },
    selectedIcon: {
      width: theme.spacing.space24,
      height: theme.spacing.space24,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.circle,
      backgroundColor: theme.color.brand.primary
    },
    emptyState: {
      minHeight: theme.spacing.space64 * 2,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      marginBottom: theme.spacing.space20,
      paddingHorizontal: theme.spacing.space20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    emptyTitle: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    emptyDescription: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    pairButton: {
      minHeight: theme.spacing.space48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    pairButtonText: { ...theme.typography.label, color: theme.color.text.primary }
  })
}
