import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileSourceControlHubStyles(theme: MobileTheme) {
  return StyleSheet.create({
    segments: {
      flexDirection: 'row',
      alignItems: 'stretch',
      width: '100%',
      backgroundColor: theme.color.bg.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    segment: {
      flex: 1,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space4,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent'
    },
    segmentActive: {
      borderBottomColor: theme.color.text.primary
    },
    segmentPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    segmentText: {
      ...theme.typography.label,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    segmentTextActive: {
      color: theme.color.text.primary
    },
    chip: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space12,
      paddingTop: theme.spacing.space12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    chipPressed: {
      opacity: 0.72
    },
    chipIcon: {
      width: theme.spacing.space20,
      alignItems: 'center'
    },
    chipNumber: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    statePill: {
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4,
      borderRadius: theme.radii.small,
      borderWidth: StyleSheet.hairlineWidth
    },
    statePillText: {
      ...theme.typography.caption,
      fontWeight: '600'
    },
    rollup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    rollupText: {
      ...theme.typography.caption,
      fontWeight: '600'
    },
    comment: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    commentText: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    chipSpacer: {
      flex: 1,
      minWidth: theme.spacing.space8
    },
    chipCreateText: {
      ...theme.typography.label,
      color: theme.color.brand.primary,
      fontWeight: '600'
    },
    chipMutedText: {
      flex: 1,
      ...theme.typography.caption,
      color: theme.color.text.tertiary
    },
    changesControls: {
      paddingHorizontal: theme.spacing.space16,
      marginTop: theme.spacing.space4
    },
    tabBody: {
      flex: 1
    },
    tabBodyHidden: {
      display: 'none'
    }
  })
}
