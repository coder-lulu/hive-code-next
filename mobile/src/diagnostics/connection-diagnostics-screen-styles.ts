import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createConnectionDiagnosticsScreenStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.color.bg.canvas },
    content: {
      flex: 1,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20
    },
    hostPicker: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.space8,
      marginBottom: theme.spacing.space16
    },
    hostChip: {
      justifyContent: 'center',
      minHeight: theme.size.minimumTouchTarget,
      paddingVertical: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    hostChipActive: {
      backgroundColor: theme.color.bg.surface,
      borderWidth: 1,
      borderColor: theme.color.border.subtle
    },
    hostChipText: { ...theme.typography.meta, color: theme.color.text.secondary, maxWidth: 160 },
    hostChipTextActive: { color: theme.color.text.primary, fontWeight: '600' },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.space8
    },
    statusText: { ...theme.typography.meta, color: theme.color.text.secondary },
    diagnosisCard: {
      backgroundColor: theme.color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.control,
      padding: theme.spacing.space16,
      marginBottom: theme.spacing.space16
    },
    diagnosisHeading: {
      ...theme.typography.meta,
      fontWeight: '600',
      color: theme.color.text.primary,
      marginBottom: theme.spacing.space4
    },
    diagnosisText: { ...theme.typography.meta, color: theme.color.text.primary, lineHeight: 18 },
    diagnosisNext: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      lineHeight: 18,
      marginTop: theme.spacing.space4
    },
    privacyHint: {
      marginTop: theme.spacing.space8,
      ...theme.typography.caption,
      color: theme.color.text.tertiary
    },
    sendButton: {
      minHeight: theme.size.minimumTouchTarget,
      marginTop: theme.spacing.space16,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingVertical: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    sendButtonText: {
      ...theme.typography.meta,
      fontWeight: '600',
      color: theme.color.text.primary
    },
    copyButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingVertical: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    copyButtonText: {
      ...theme.typography.meta,
      fontWeight: '600',
      color: theme.color.text.primary
    },
    emptyText: { ...theme.typography.meta, color: theme.color.text.tertiary, lineHeight: 18 }
  })
}
