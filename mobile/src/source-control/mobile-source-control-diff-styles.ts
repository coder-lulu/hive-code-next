import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileSourceControlDiffStyles(theme: MobileTheme) {
  return StyleSheet.create({
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space24
    },
    stateTitle: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary,
      marginBottom: theme.spacing.space4
    },
    stateText: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    retryButton: {
      minHeight: theme.size.minimumTouchTarget,
      marginTop: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      alignItems: 'center',
      justifyContent: 'center'
    },
    retryText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    diffDrawerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingBottom: theme.spacing.space12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    diffDrawerTitleBlock: {
      flex: 1,
      minWidth: 0
    },
    diffDrawerTitle: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    diffDrawerMeta: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space4
    },
    diffCloseButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      alignItems: 'center',
      justifyContent: 'center'
    },
    diffState: {
      minHeight: theme.spacing.space64 * 2 + theme.spacing.space32,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space16
    },
    diffLines: {
      paddingTop: theme.spacing.space12,
      paddingBottom: theme.spacing.space16
    },
    diffTruncatedText: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginBottom: theme.spacing.space8
    },
    diffLine: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space4,
      paddingVertical: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space4
    },
    diffLineAdd: {
      backgroundColor: theme.color.bg.subtle
    },
    diffLineDelete: {
      backgroundColor: theme.color.bg.subtle
    },
    diffLineNumber: {
      width: theme.spacing.space40,
      ...theme.typography.code,
      color: theme.color.text.tertiary,
      textAlign: 'right'
    },
    diffLinePrefix: {
      width: theme.spacing.space12,
      ...theme.typography.code,
      color: theme.color.text.secondary
    },
    diffLineText: {
      flex: 1,
      ...theme.typography.code,
      color: theme.color.text.primary
    }
  })
}
