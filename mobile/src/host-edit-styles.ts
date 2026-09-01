import { Platform, StyleSheet } from 'react-native'
import type { MobileTheme } from './theme/mobile-theme'

export function createHostEditStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.color.bg.canvas },
    flex: { flex: 1 },
    topRow: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space20,
      gap: theme.spacing.space8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center'
    },
    heading: { ...theme.typography.pageTitle, flex: 1, color: theme.color.text.primary },
    saveButton: {
      minWidth: 64,
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space16,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected,
      alignItems: 'center',
      justifyContent: 'center'
    },
    saveButtonDisabled: { opacity: 0.4 },
    saveButtonText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    form: {
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20,
      gap: theme.spacing.space8
    },
    help: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      marginBottom: theme.spacing.space8
    },
    label: {
      ...theme.typography.label,
      color: theme.color.text.secondary,
      fontWeight: '500',
      marginTop: theme.spacing.space12
    },
    input: {
      minHeight: theme.size.minimumTouchTarget,
      backgroundColor: theme.color.bg.surface,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      color: theme.color.text.primary,
      ...theme.typography.body,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: Platform.OS === 'ios' ? 12 : 10
    },
    hint: { ...theme.typography.caption, color: theme.color.text.tertiary },
    preview: {
      ...theme.typography.code,
      marginTop: theme.spacing.space8,
      color: theme.color.text.secondary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : theme.typography.code.fontFamily
    },
    previewError: {
      ...theme.typography.body,
      marginTop: theme.spacing.space8,
      color: theme.color.status.danger
    },
    errorText: {
      ...theme.typography.body,
      color: theme.color.status.danger,
      marginTop: theme.spacing.space12
    },
    errorState: {
      flex: 1,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space24,
      gap: theme.spacing.space12
    },
    loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    secondaryButton: {
      alignSelf: 'flex-start',
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      alignItems: 'center',
      justifyContent: 'center'
    },
    secondaryButtonText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '500'
    }
  })
}
