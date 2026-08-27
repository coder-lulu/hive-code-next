import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileConnectedHomeStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.color.bg.canvas },
    list: {
      paddingHorizontal: theme.spacing.space20,
      paddingBottom: theme.spacing.space24
    },
    hero: {
      paddingTop: theme.spacing.space12,
      paddingBottom: theme.spacing.space16
    },
    heroTitle: { ...theme.typography.pageTitle, color: theme.color.text.primary },
    statsRow: {
      flexDirection: 'row',
      gap: theme.spacing.space8,
      marginBottom: theme.spacing.space24
    },
    statCard: {
      flex: 1,
      minHeight: 72,
      justifyContent: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    statValue: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    statLabel: { ...theme.typography.caption, color: theme.color.text.tertiary },
    sectionHeading: {
      ...theme.typography.meta,
      marginBottom: theme.spacing.space8,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    sectionHeadingTightTop: { marginTop: theme.spacing.space24 },
    cardGap: { height: theme.spacing.space8 },
    hostCardPressed: { backgroundColor: theme.color.bg.subtle },
    cardDisabled: { opacity: 0.45 },
    resumeCard: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    resumeIcon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    resumeMain: { flex: 1, minWidth: 0 },
    resumeTitle: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    resumeSub: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space4
    },
    repoDot: {
      width: theme.spacing.space8,
      height: theme.spacing.space8,
      borderRadius: theme.radii.circle
    },
    resumeSubText: { ...theme.typography.caption, flex: 1, color: theme.color.text.secondary },
    taskHomeCard: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    taskHomeIcon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    taskHomeMain: { flex: 1, minWidth: 0 },
    taskHomeTitle: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    taskHomeSubtitle: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space4,
      color: theme.color.text.secondary
    },
    taskHomeTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
      marginLeft: theme.spacing.space8
    },
    taskHomeProviderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing.space4
    },
    taskHomeProviderButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    taskHomeProviderButtonPressed: { backgroundColor: theme.color.bg.subtle },
    accountsCard: {
      gap: theme.spacing.space12,
      marginBottom: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    accountsHostLabel: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      fontWeight: '500'
    },
    accountsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12
    },
    accountsIcon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    accountsInfo: { flex: 1, minWidth: 0, gap: theme.spacing.space4 },
    accountsEmail: {
      ...theme.typography.meta,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    accountsBars: {
      flexDirection: 'row',
      gap: theme.spacing.space12,
      marginTop: theme.spacing.space4
    }
  })
}
