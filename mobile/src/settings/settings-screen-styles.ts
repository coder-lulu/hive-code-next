import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createSettingsScreenStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, width: '100%', backgroundColor: theme.color.bg.canvas },
    topBar: {
      minHeight: 56,
      paddingHorizontal: theme.spacing.space8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    backButton: {
      width: 44,
      height: 44,
      borderRadius: theme.radii.control,
      alignItems: 'center',
      justifyContent: 'center'
    },
    content: {
      width: '100%',
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20,
      gap: theme.spacing.space24
    },
    appearanceRow: {
      minHeight: 88,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    appearanceContent: { minWidth: 0, flex: 1, gap: theme.spacing.space8 },
    themeOptions: {
      minHeight: 44,
      flexDirection: 'row',
      gap: theme.spacing.space4,
      padding: theme.spacing.space4,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    themeOption: {
      minWidth: 44,
      minHeight: 36,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.small
    },
    themeOptionSelected: { backgroundColor: theme.color.bg.selected },
    themeOptionPressed: { opacity: 0.72 },
    themeOptionText: { color: theme.color.text.secondary },
    themeOptionTextSelected: { color: theme.color.text.inverse },
    pressed: { backgroundColor: theme.color.bg.subtle },
    credentialRow: {
      minHeight: 72,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12
    },
    credentialCopy: { flex: 1, flexShrink: 1, gap: theme.spacing.space4 },
    retryButton: {
      minWidth: 64,
      minHeight: 44,
      paddingHorizontal: theme.spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      alignItems: 'center',
      justifyContent: 'center'
    }
  })
}
