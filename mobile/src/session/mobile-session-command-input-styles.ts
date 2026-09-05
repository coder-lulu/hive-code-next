import { Platform, StyleSheet } from 'react-native'

import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileSessionCommandInputStyles(theme: MobileTheme) {
  const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

  return StyleSheet.create({
    createWarningBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      backgroundColor: theme.color.bg.subtle,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8
    },
    createWarningText: {
      ...theme.typography.caption,
      flex: 1,
      color: theme.color.text.primary
    },
    createWarningDismiss: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space24
    },
    emptyText: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      marginBottom: theme.spacing.space16,
      textAlign: 'center'
    },
    createError: {
      ...theme.typography.meta,
      color: theme.color.status.dangerText,
      marginBottom: theme.spacing.space8,
      textAlign: 'center'
    },
    emptyActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: theme.spacing.space8
    },
    createButton: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      backgroundColor: theme.color.bg.selected,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control
    },
    createButtonDisabled: {
      opacity: 0.45
    },
    createButtonText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    commandDock: {
      zIndex: 20,
      backgroundColor: theme.color.bg.surface
    },
    accessoryBar: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    accessoryScroll: {
      flex: 1,
      minWidth: 0
    },
    accessoryContent: {
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4,
      gap: theme.spacing.space4
    },
    accessoryKey: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.bg.subtle,
      paddingHorizontal: theme.spacing.space8,
      borderRadius: theme.radii.control
    },
    accessoryKeyPressed: {
      backgroundColor: theme.color.border.default
    },
    accessoryKeyActive: {
      backgroundColor: theme.color.bg.selected
    },
    customAccessoryKey: {
      borderWidth: 1,
      borderColor: theme.color.border.default
    },
    accessoryKeyDisabled: {
      opacity: 0.35
    },
    accessoryKeyText: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      fontFamily: monoFont
    },
    accessoryKeyTextActive: {
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    accessoryKeyTextDisabled: {
      color: theme.color.text.tertiary
    },
    keyboardDismissKey: {
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: theme.spacing.space8,
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.control,
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget
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
    inputBar: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    textInput: {
      ...theme.typography.code,
      flex: 1,
      minHeight: theme.size.minimumTouchTarget,
      backgroundColor: theme.color.bg.canvas,
      color: theme.color.text.primary,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      fontFamily: monoFont,
      marginRight: theme.spacing.space8
    },
    liveInputBar: {
      gap: theme.spacing.space8
    },
    liveInputFocusTarget: {
      flex: 1,
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      backgroundColor: theme.color.bg.canvas,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12
    },
    liveInputFocusTargetPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    liveInputFocusTargetDisabled: {
      opacity: 0.45
    },
    liveInputCapture: {
      position: 'absolute',
      opacity: 0,
      width: 1,
      height: 1,
      color: theme.color.text.primary
    },
    sendButton: {
      backgroundColor: theme.color.bg.selected,
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center'
    },
    dictationButton: {
      backgroundColor: theme.color.bg.subtle,
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      borderWidth: 1,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: theme.spacing.space8
    },
    dictationButtonActive: {
      backgroundColor: theme.color.brand.subtle,
      borderColor: theme.color.brand.primary
    },
    sendButtonDisabled: {
      opacity: 0.35
    }
  })
}
