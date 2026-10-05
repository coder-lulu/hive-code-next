import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'

export function createMobileNativeChatComposerStyles(theme: MobileTheme) {
  return StyleSheet.create({
    attachmentStrip: {
      maxHeight: 76,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    attachmentStripContent: {
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8
    },
    attachmentThumb: {
      width: 60,
      height: 60,
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.subtle
    },
    attachmentImage: {
      width: '100%',
      height: '100%',
      borderRadius: theme.radii.control
    },
    attachmentRemove: {
      // Inset inside the thumb: Android drops touches outside the parent's bounds,
      // so an overhanging badge would lose part of its tap target.
      position: 'absolute',
      top: 2,
      right: 2,
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.bg.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default
    },
    composerInset: {
      paddingHorizontal: theme.spacing.space12,
      paddingTop: theme.spacing.space8,
      paddingBottom: theme.spacing.space12
    },
    bar: {
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface,
      overflow: 'hidden'
    },
    actionRow: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    actionSpacer: {
      flex: 1
    },
    input: {
      ...theme.typography.body,
      fontSize: TEXT_INPUT_FONT_SIZE,
      width: '100%',
      maxHeight: 140,
      minHeight: theme.size.minimumTouchTarget,
      color: theme.color.text.primary,
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingTop: theme.spacing.space8,
      paddingBottom: theme.spacing.space8
    },
    iconButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    },
    sendButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.bg.selected
    },
    sendButtonDisabled: {
      backgroundColor: theme.color.bg.subtle
    },
    pressed: {
      opacity: 0.7
    }
  })
}
