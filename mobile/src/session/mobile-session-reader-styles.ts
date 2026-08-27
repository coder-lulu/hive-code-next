import { Platform, StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileSessionReaderStyles(theme: MobileTheme) {
  return StyleSheet.create({
    markdownEditor: {
      flex: 1,
      position: 'relative',
      backgroundColor: theme.color.bg.canvas
    },
    markdownState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space24,
      gap: theme.spacing.space12,
      backgroundColor: theme.color.bg.canvas
    },
    markdownError: {
      ...theme.typography.body,
      color: theme.color.status.danger
    },
    markdownRefreshButton: {
      minHeight: theme.size.minimumTouchTarget,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      backgroundColor: theme.color.bg.surface,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8
    },
    markdownRefreshText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    markdownFloatingBar: {
      position: 'absolute',
      left: theme.spacing.space12,
      right: theme.spacing.space12,
      bottom: theme.spacing.space16,
      alignItems: 'flex-end',
      gap: theme.spacing.space4
    },
    markdownFloatingStatus: {
      ...theme.typography.meta,
      maxWidth: '100%',
      alignSelf: 'flex-end',
      overflow: 'hidden',
      color: theme.color.text.secondary,
      backgroundColor: theme.color.bg.elevated,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4
    },
    markdownFloatingActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      gap: theme.spacing.space4
    },
    markdownFloatingButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      backgroundColor: theme.color.bg.elevated,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8
    },
    markdownKeyboardDismissButton: {
      width: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: 0
    },
    markdownSaveButton: {
      backgroundColor: theme.color.bg.selected,
      borderColor: theme.color.bg.selected
    },
    markdownButtonDisabled: {
      opacity: 0.45
    },
    markdownFloatingButtonText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    markdownSaveButtonText: {
      color: theme.color.text.inverse
    },
    keyboardDismissGlyph: {
      alignItems: 'center',
      height: theme.spacing.space20,
      justifyContent: 'flex-start',
      position: 'relative',
      width: theme.spacing.space20
    },
    keyboardDismissChevron: {
      bottom: -2,
      position: 'absolute'
    },
    markdownTextInput: {
      ...theme.typography.body,
      flex: 1,
      minHeight: 0,
      color: theme.color.text.primary,
      backgroundColor: theme.color.bg.canvas,
      paddingHorizontal: theme.spacing.space16,
      paddingTop: theme.spacing.space16,
      paddingBottom: theme.spacing.space64,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })
    },
    filePreviewScroll: {
      flex: 1,
      minHeight: 0,
      backgroundColor: theme.color.bg.surface
    },
    filePreviewContent: {
      paddingHorizontal: theme.spacing.space16,
      paddingTop: theme.spacing.space16,
      paddingBottom: theme.spacing.space24
    },
    filePreviewText: {
      ...theme.typography.code,
      color: theme.color.text.primary,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })
    },
    imagePreviewContainer: {
      flex: 1,
      minHeight: 0,
      backgroundColor: theme.color.bg.surface
    },
    imagePreviewScroll: {
      flex: 1
    },
    imagePreviewContent: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space16
    },
    imagePreview: {
      width: '100%',
      height: '100%',
      minHeight: 200
    },
    diffNotesToolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    diffNotesTitleRow: {
      minWidth: 0,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    diffNotesTitle: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    diffNotesActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    diffNotesActionButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space8,
      backgroundColor: theme.color.bg.elevated
    },
    diffNotesActionText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    diffLineBlock: {
      marginBottom: theme.spacing.space4
    },
    diffLine: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      borderLeftWidth: 2,
      borderLeftColor: theme.color.border.subtle,
      paddingRight: theme.spacing.space8
    },
    diffLineAdded: {
      backgroundColor: theme.color.bg.subtle,
      borderLeftColor: theme.color.status.success
    },
    diffLineDeleted: {
      backgroundColor: theme.color.bg.subtle,
      borderLeftColor: theme.color.status.danger
    },
    diffGutter: {
      ...theme.typography.code,
      width: 42,
      paddingRight: theme.spacing.space8,
      textAlign: 'right',
      color: theme.color.text.tertiary,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })
    },
    diffText: {
      ...theme.typography.code,
      flex: 1,
      color: theme.color.text.primary,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })
    },
    diffPrefix: {
      color: theme.color.text.tertiary
    },
    diffPrefixAdded: {
      color: theme.color.status.success
    },
    diffPrefixDeleted: {
      color: theme.color.status.danger
    }
  })
}
