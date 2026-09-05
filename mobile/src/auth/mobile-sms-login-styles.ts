import { Platform, StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileSmsLoginStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.color.overlay },
    sheet: {
      overflow: 'hidden',
      backgroundColor: theme.color.bg.surface,
      borderTopLeftRadius: theme.radii.overlay,
      borderTopRightRadius: theme.radii.overlay,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space16,
      paddingBottom: theme.spacing.space24,
      ...Platform.select({
        ios: {
          shadowColor: theme.color.text.primary,
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.08,
          shadowRadius: 10
        },
        android: { elevation: 6 }
      })
    },
    topRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    pressed: { backgroundColor: theme.color.bg.subtle },
    title: { ...theme.typography.pageTitle, color: theme.color.text.primary, flex: 1 },
    subtitle: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space8
    },
    inputLabel: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      marginTop: theme.spacing.space20,
      marginBottom: theme.spacing.space8
    },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      paddingHorizontal: theme.spacing.space16,
      ...theme.typography.body
    },
    inputFocused: { borderColor: theme.color.brand.primary },
    error: {
      ...theme.typography.meta,
      color: theme.color.status.dangerText,
      marginTop: theme.spacing.space8
    },
    action: {
      minHeight: 48,
      marginTop: theme.spacing.space20,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    actionLabel: { ...theme.typography.label, color: theme.color.text.inverse },
    actionDisabled: { opacity: 0.42 },
    helper: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space12
    }
  })
}
