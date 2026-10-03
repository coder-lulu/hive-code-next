import { StyleSheet } from 'react-native'
import { darkTheme, type MobileTheme } from '../theme/mobile-theme'

export function createFilePreviewStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    header: {
      backgroundColor: theme.color.bg.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    topBar: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space12
    },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    backButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    titleBlock: {
      flex: 1,
      minWidth: 0
    },
    title: {
      ...theme.typography.pageTitle,
      color: theme.color.text.primary
    },
    meta: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space4,
      color: theme.color.text.secondary
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space12,
      padding: theme.spacing.space24
    },
    stateText: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    errorText: {
      ...theme.typography.body,
      color: theme.color.status.dangerText,
      textAlign: 'center'
    },
    retryButton: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      paddingHorizontal: theme.spacing.space16
    },
    retryText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    saveButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    saveButtonDisabled: {
      opacity: 0.42
    },
    scroll: {
      flex: 1,
      backgroundColor: theme.color.bg.surface
    },
    sourceScroll: {
      flex: 1,
      backgroundColor: darkTheme.color.bg.surface
    },
    textContent: {
      padding: theme.spacing.space16,
      paddingBottom: theme.spacing.space24
    },
    textPreview: {
      ...theme.typography.code,
      color: darkTheme.color.text.primary
    },
    markdownContent: {
      padding: theme.spacing.space16,
      paddingBottom: theme.spacing.space24
    },
    modeContainer: {
      flex: 1,
      backgroundColor: theme.color.bg.surface
    },
    modeToolbar: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      marginHorizontal: theme.spacing.space16,
      marginVertical: theme.spacing.space8,
      padding: theme.spacing.space4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.subtle
    },
    modeToggle: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: 'transparent'
    },
    modeToggleActive: {
      backgroundColor: theme.color.bg.selected
    },
    truncatedNote: {
      ...theme.typography.caption,
      marginBottom: theme.spacing.space12,
      color: theme.color.text.secondary
    },
    imageContainer: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    imageScrollContent: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space16
    },
    image: {
      backgroundColor: theme.color.bg.surface
    },
    editContainer: {
      flex: 1,
      backgroundColor: darkTheme.color.bg.surface,
      padding: theme.spacing.space16
    },
    saveErrorText: {
      ...theme.typography.caption,
      marginBottom: theme.spacing.space8,
      color: theme.color.status.dangerText
    },
    editInput: {
      ...theme.typography.code,
      flex: 1,
      padding: 0,
      color: darkTheme.color.text.primary
    }
  })
}
