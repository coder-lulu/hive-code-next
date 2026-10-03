import { StyleSheet } from 'react-native'

import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileSessionReviewCommentStyles(theme: MobileTheme) {
  return StyleSheet.create({
    diffCommentAddButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    diffCommentAddButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    diffCommentButtonDisabled: {
      opacity: 0.45
    },
    diffCommentList: {
      gap: theme.spacing.space4,
      marginLeft: theme.size.minimumTouchTarget,
      marginRight: theme.spacing.space8,
      marginTop: theme.spacing.space4
    },
    diffCommentCard: {
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4
    },
    diffCommentHeader: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    diffCommentMeta: {
      ...theme.typography.caption,
      flex: 1,
      color: theme.color.text.tertiary,
      fontWeight: '600'
    },
    diffCommentDeleteButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.circle
    },
    diffCommentBody: {
      ...theme.typography.meta,
      color: theme.color.text.primary,
      paddingBottom: theme.spacing.space8
    },
    diffCommentComposer: {
      gap: theme.spacing.space8,
      marginLeft: theme.size.minimumTouchTarget,
      marginRight: theme.spacing.space8,
      marginTop: theme.spacing.space4,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      padding: theme.spacing.space8
    },
    diffCommentInput: {
      minHeight: 72,
      marginRight: 0,
      paddingTop: theme.spacing.space8,
      paddingBottom: theme.spacing.space8
    },
    diffCommentComposerActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: theme.spacing.space8
    },
    diffCommentSecondaryAction: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12
    },
    diffCommentSecondaryText: {
      ...theme.typography.label,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    diffCommentPrimaryAction: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected,
      paddingHorizontal: theme.spacing.space12
    },
    diffCommentPrimaryText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    toast: {
      position: 'absolute',
      bottom: theme.spacing.space16,
      alignSelf: 'center',
      left: 0,
      right: 0,
      alignItems: 'center'
    },
    toastText: {
      ...theme.typography.meta,
      backgroundColor: theme.color.bg.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      color: theme.color.text.primary,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control,
      overflow: 'hidden'
    }
  })
}
