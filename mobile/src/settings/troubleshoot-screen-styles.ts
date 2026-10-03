import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createTroubleshootScreenStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.color.bg.canvas },
    scroll: { flex: 1 },
    content: {
      gap: theme.spacing.space24,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20
    },
    actions: { gap: theme.spacing.space12 },
    primaryButton: {
      minHeight: theme.spacing.space48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    primaryButtonLabel: { ...theme.typography.label, color: theme.color.text.inverse },
    secondaryButton: {
      minHeight: theme.spacing.space48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    secondaryButtonLabel: { ...theme.typography.label, color: theme.color.text.primary },
    buttonPressed: { opacity: 0.72 },
    secondaryPressed: { backgroundColor: theme.color.bg.subtle },
    buttonDisabled: { opacity: 0.4 },
    groupTitle: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginBottom: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space4
    },
    group: {
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    divider: {
      height: 1,
      marginLeft: theme.spacing.space16,
      backgroundColor: theme.color.border.subtle
    },
    checkRow: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    checkCopy: { minWidth: 0, flex: 1, gap: theme.spacing.space4 },
    checkLabel: { ...theme.typography.body, color: theme.color.text.primary },
    checkDetail: { ...theme.typography.meta, color: theme.color.text.secondary },
    checkDetailFail: { color: theme.color.status.dangerText },
    checkDetailWarn: { color: theme.color.status.warningText },
    accordionHeader: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    accordionTitle: { ...theme.typography.body, flex: 1, color: theme.color.text.primary },
    accordionBody: {
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      paddingBottom: theme.spacing.space16
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space8
    },
    bulletDot: {
      width: theme.spacing.space4,
      height: theme.spacing.space4,
      marginTop: theme.spacing.space8,
      borderRadius: theme.radii.circle,
      backgroundColor: theme.color.text.tertiary
    },
    stepText: { ...theme.typography.meta, flex: 1, color: theme.color.text.secondary }
  })
}
