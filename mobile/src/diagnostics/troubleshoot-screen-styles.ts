import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createTroubleshootScreenStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    scroll: {
      flex: 1
    },
    scrollContent: {
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20,
      paddingBottom: theme.spacing.space32
    },
    diagnosticButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.control,
      paddingVertical: theme.spacing.space16,
      paddingHorizontal: theme.spacing.space20,
      marginBottom: theme.spacing.space20
    },
    diagnosticButtonPressed: {
      opacity: 0.7
    },
    diagnosticButtonDisabled: {
      opacity: 0.5
    },
    diagnosticButtonLabel: {
      ...theme.typography.label,
      color: theme.color.text.primary
    },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingVertical: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16
    },
    checkLabel: {
      ...theme.typography.body,
      color: theme.color.text.primary
    },
    checkDetail: {
      flex: 1,
      textAlign: 'right',
      ...theme.typography.meta,
      color: theme.color.text.tertiary
    },
    checkDetailFail: {
      color: theme.color.status.dangerText
    },
    sectionHeading: {
      ...theme.typography.label,
      color: theme.color.text.tertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: theme.spacing.space8,
      marginTop: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space4
    },
    section: {
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.card,
      overflow: 'hidden',
      marginBottom: theme.spacing.space20
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.color.border.subtle,
      marginHorizontal: theme.spacing.space16
    },
    rowPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    accordionHeader: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingVertical: theme.spacing.space16,
      paddingHorizontal: theme.spacing.space16
    },
    accordionTitle: {
      flex: 1,
      ...theme.typography.body,
      color: theme.color.text.primary
    },
    accordionBody: {
      paddingHorizontal: theme.spacing.space16,
      paddingBottom: theme.spacing.space16,
      gap: theme.spacing.space8
    },
    stepRow: {
      flexDirection: 'row',
      gap: theme.spacing.space8
    },
    bullet: {
      ...theme.typography.meta,
      color: theme.color.text.tertiary,
      lineHeight: 18
    },
    stepText: {
      flex: 1,
      ...theme.typography.meta,
      color: theme.color.text.tertiary,
      lineHeight: 18
    }
  })
}
