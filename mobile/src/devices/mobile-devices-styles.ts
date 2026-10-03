import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { createMobileSessionsStyles } from '../sessions/mobile-sessions-styles'

export function createMobileDevicesStyles(theme: MobileTheme) {
  return StyleSheet.create({
    ...createMobileSessionsStyles(theme),
    sheetTitle: { ...theme.typography.pageTitle, color: theme.color.text.primary, flex: 1 },
    newSession: { ...createMobileSessionsStyles(theme).newSession, width: 'auto' },
    subtitle: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    addLabel: { ...theme.typography.label, color: theme.color.brand.primary },
    headingCompact: { alignItems: 'flex-start', flexWrap: 'wrap' },
    filterBar: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    sectionHeading: {
      ...theme.typography.pageTitle,
      color: theme.color.text.primary,
      marginTop: theme.spacing.space24,
      marginBottom: theme.spacing.space12
    },
    deviceRow: { padding: theme.spacing.space16, backgroundColor: theme.color.bg.surface },
    currentCard: {
      borderRadius: theme.radii.card,
      overflow: 'hidden',
      backgroundColor: theme.color.bg.surface
    },
    deviceFirst: { borderTopLeftRadius: theme.radii.card, borderTopRightRadius: theme.radii.card },
    deviceLast: {
      borderBottomLeftRadius: theme.radii.card,
      borderBottomRightRadius: theme.radii.card
    },
    deviceBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    deviceHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space12 },
    deviceHeaderCompact: { flexWrap: 'wrap', gap: theme.spacing.space8 },
    deviceIcon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    deviceCopy: { flex: 1, minWidth: 0, gap: theme.spacing.space4 },
    deviceCopyCompact: { flexBasis: '65%' },
    deviceName: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    deviceMeta: { ...theme.typography.meta, color: theme.color.text.secondary },
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      flexShrink: 0
    },
    statusDot: {
      width: theme.spacing.space8,
      height: theme.spacing.space8,
      borderRadius: theme.radii.circle
    },
    statusCompact: { marginLeft: theme.size.minimumTouchTarget + theme.spacing.space8, flex: 1 },
    footerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space16,
      paddingTop: theme.spacing.space8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    deviceHint: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      flex: 1,
      minWidth: 0
    },
    textAction: {
      backgroundColor: theme.color.bg.surface,
      width: 'auto',
      minHeight: theme.size.minimumTouchTarget,
      minWidth: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space8
    },
    help: {
      justifyContent: 'space-between',
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      marginTop: theme.spacing.space16,
      borderRadius: theme.radii.control
    },
    helpLabel: { ...theme.typography.body, color: theme.color.text.secondary, flex: 1 },
    error: {
      ...theme.typography.meta,
      color: theme.color.status.dangerText,
      marginTop: theme.spacing.space8
    },
    helpSection: { gap: theme.spacing.space12, marginTop: theme.spacing.space16 }
  })
}
