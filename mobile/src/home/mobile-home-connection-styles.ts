import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileHomeConnectionStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: { flex: 1 },
    content: {
      width: '100%',
      alignSelf: 'center',
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space24,
      gap: theme.spacing.space24
    },
    panel: { gap: theme.spacing.space16 },
    iconTile: {
      alignSelf: 'center',
      width: theme.spacing.space64,
      height: theme.spacing.space64,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.subtle
    },
    panelCopy: { gap: theme.spacing.space8 },
    panelTitle: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    hint: { ...theme.typography.meta, color: theme.color.text.secondary },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: theme.spacing.space48,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      gap: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    primaryText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      flexShrink: 1,
      textAlign: 'center'
    },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.5 },
    stepsSection: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle,
      paddingTop: theme.spacing.space20,
      gap: theme.spacing.space16
    },
    stepRow: { flexDirection: 'row', gap: theme.spacing.space16 },
    stepNum: {
      width: theme.spacing.space40,
      minHeight: theme.spacing.space40,
      alignSelf: 'flex-start',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    stepNumText: { ...theme.typography.label, color: theme.color.text.secondary },
    stepText: { flex: 1, gap: theme.spacing.space4 },
    stepTitle: { ...theme.typography.label, color: theme.color.text.primary },
    help: {
      minHeight: theme.size.minimumTouchTarget,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      borderRadius: theme.radii.control
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      flexWrap: 'wrap'
    },
    refresh: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      borderRadius: theme.radii.control
    },
    error: { ...theme.typography.meta, color: theme.color.status.dangerText }
  })
}
