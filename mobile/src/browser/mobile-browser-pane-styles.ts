import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileBrowserPaneStyles(theme: MobileTheme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      minHeight: 0,
      backgroundColor: theme.color.bg.canvas
    },
    toolbar: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    viewport: {
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
      backgroundColor: theme.color.bg.canvas
    },
    browserImageHost: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    },
    browserImageFill: {
      width: '100%',
      height: '100%'
    },
    browserImageLayer: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center'
    },
    browserImageLayerHidden: {
      opacity: 0
    },
    browserZoomOffset: {
      alignItems: 'center',
      justifyContent: 'center'
    },
    browserFrameBox: {
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    },
    browserImage: {
      backgroundColor: theme.color.bg.canvas
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space24,
      gap: theme.spacing.space8
    },
    emptyOverlay: {
      backgroundColor: theme.color.bg.canvas
    },
    loadingIndicatorHost: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    errorText: {
      ...theme.typography.meta,
      maxWidth: theme.size.overlayMaxWidth,
      color: theme.color.status.danger,
      backgroundColor: theme.color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      textAlign: 'center',
      overflow: 'hidden'
    },
    dialogOverlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 30,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space24,
      backgroundColor: theme.color.overlay
    },
    dialogCard: {
      width: '100%',
      maxWidth: theme.size.overlayMaxWidth,
      borderRadius: theme.radii.overlay,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.elevated,
      padding: theme.spacing.space20
    },
    dialogTitle: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary
    },
    dialogMessage: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space8
    },
    dialogActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space20
    },
    dialogButton: {
      minHeight: theme.size.minimumTouchTarget,
      minWidth: theme.size.minimumTouchTarget,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      paddingHorizontal: theme.spacing.space16,
      alignItems: 'center',
      justifyContent: 'center'
    },
    dialogButtonPrimary: {
      borderColor: theme.color.bg.selected,
      backgroundColor: theme.color.bg.selected
    },
    dialogButtonPressed: {
      opacity: 0.76
    },
    dialogButtonText: {
      ...theme.typography.label,
      color: theme.color.text.primary
    },
    dialogButtonPrimaryText: {
      color: theme.color.text.inverse
    },
    keyboardDock: {
      zIndex: 20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      paddingTop: theme.spacing.space8,
      paddingBottom: theme.spacing.space8
    },
    keyboardInput: {
      ...theme.typography.code,
      flex: 1,
      minHeight: theme.size.minimumTouchTarget,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12
    },
    keyboardInputFocused: {
      borderColor: theme.color.brand.primary
    },
    sendButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.bg.subtle
    },
    sendButtonEnabled: {
      backgroundColor: theme.color.bg.selected
    },
    sendButtonPressed: {
      opacity: 0.76
    },
    disabled: {
      opacity: 0.45
    }
  })
}
