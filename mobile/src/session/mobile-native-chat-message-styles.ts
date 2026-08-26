import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileNativeChatMessageStyles(theme: MobileTheme) {
  return StyleSheet.create({
    row: {
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8
    },
    rowUser: {
      alignItems: 'flex-end'
    },
    content: {
      maxWidth: '100%',
      gap: theme.spacing.space8
    },
    userBubble: {
      maxWidth: '88%',
      backgroundColor: theme.color.bg.selected,
      borderRadius: theme.radii.card,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8
    },
    userText: {
      ...theme.typography.body,
      color: theme.color.text.inverse,
      fontWeight: '500'
    },
    controls: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: theme.spacing.space4,
      opacity: 0.72
    },
    controlButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    controlPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    copied: {
      backgroundColor: theme.color.brand.subtle,
      borderRadius: theme.radii.card
    },
    reasoning: {
      opacity: 0.72
    },
    toolRun: {
      marginTop: theme.spacing.space4
    },
    toolRunHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    toolRunToggle: {
      flex: 1,
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    controlsRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end'
    },
    toolRunCount: {
      ...theme.typography.code,
      color: theme.color.status.success,
      fontWeight: '600'
    },
    toolRunLabel: {
      ...theme.typography.code,
      flex: 1,
      color: theme.color.text.tertiary
    },
    toolRunBody: {
      paddingLeft: theme.spacing.space8,
      borderLeftWidth: 2,
      borderLeftColor: theme.color.border.subtle,
      marginTop: theme.spacing.space4
    },
    toolLine: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    toolName: {
      ...theme.typography.code,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    toolPreview: {
      ...theme.typography.code,
      flex: 1,
      color: theme.color.text.tertiary
    },
    toolPreviewLink: {
      color: theme.color.brand.primary,
      textDecorationLine: 'underline'
    },
    toolDetail: {
      paddingLeft: theme.spacing.space16,
      paddingBottom: theme.spacing.space4,
      gap: theme.spacing.space4
    },
    mono: {
      ...theme.typography.code,
      color: theme.color.text.secondary
    },
    toolResult: {
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      padding: theme.spacing.space12
    },
    toolResultError: {
      borderLeftWidth: 2,
      borderLeftColor: theme.color.status.danger
    },
    imageRef: {
      ...theme.typography.body,
      color: theme.color.text.secondary
    },
    imageThumb: {
      width: 200,
      height: 150,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.subtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle
    },
    diff: {
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      paddingVertical: theme.spacing.space4,
      overflow: 'hidden'
    },
    diffLine: {
      ...theme.typography.code,
      color: theme.color.text.secondary,
      paddingHorizontal: theme.spacing.space8
    },
    diffAdd: {
      color: theme.color.status.success,
      backgroundColor: theme.color.bg.subtle
    },
    diffDel: {
      color: theme.color.status.danger,
      backgroundColor: theme.color.bg.subtle
    },
    diffMeta: {
      color: theme.color.text.tertiary
    }
  })
}
