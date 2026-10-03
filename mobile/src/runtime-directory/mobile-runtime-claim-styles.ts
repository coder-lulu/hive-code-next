import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileRuntimeClaimStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.color.bg.canvas },
    viewport: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8
    },
    back: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: theme.radii.control
    },
    title: { ...theme.typography.pageTitle, color: theme.color.text.primary, flex: 1 },
    content: {
      width: '100%',
      alignSelf: 'center',
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space24,
      gap: theme.spacing.space20
    },
    form: { gap: theme.spacing.space16 },
    body: { ...theme.typography.body, color: theme.color.text.secondary },
    label: { ...theme.typography.label, color: theme.color.text.primary },
    details: {
      paddingVertical: theme.spacing.space16,
      gap: theme.spacing.space12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle
    },
    value: { ...theme.typography.body, color: theme.color.text.primary },
    input: {
      minHeight: theme.spacing.space48,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      ...theme.typography.body
    },
    focused: { borderColor: theme.color.brand.primary },
    action: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    secondary: {
      backgroundColor: theme.color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default
    },
    actionText: { ...theme.typography.label, color: theme.color.text.inverse, textAlign: 'center' },
    secondaryText: { color: theme.color.text.primary },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85 },
    error: { ...theme.typography.meta, color: theme.color.status.dangerText },
    hint: { ...theme.typography.meta, color: theme.color.text.secondary }
  })
}
