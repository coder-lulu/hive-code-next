import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileAccountsScreenStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: theme.size.navigationBarHeight,
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
    iconButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center'
    },
    titleWrap: {
      flex: 1
    },
    heading: {
      ...theme.typography.pageTitle,
      color: theme.color.text.primary
    },
    subheading: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      marginTop: 1
    },
    scroll: {
      paddingHorizontal: theme.spacing.space16,
      paddingTop: theme.spacing.space16
    },
    section: {
      marginBottom: theme.spacing.space24
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      marginBottom: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space4
    },
    sectionHeading: {
      ...theme.typography.meta,
      fontWeight: '600',
      color: theme.color.text.secondary
    },
    card: {
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      overflow: 'hidden'
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: theme.size.groupedListRowMinHeight,
      paddingVertical: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16
    },
    rowPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    rowMain: {
      flex: 1,
      gap: theme.spacing.space4
    },
    // Why: fixed-width trailing slot so the usage bars in `rowMain` keep the
    // same width whether or not the row is currently selected (otherwise the
    // checkmark on the active account squeezes the bars narrower than the
    // inactive rows above/below it).
    rowTrailing: {
      width: 24,
      alignItems: 'flex-end',
      justifyContent: 'center',
      marginLeft: theme.spacing.space8
    },
    rowTitle: {
      ...theme.typography.body,
      fontWeight: '500',
      color: theme.color.text.primary
    },
    rowSubtitle: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.color.border.subtle,
      marginHorizontal: theme.spacing.space16
    },
    usageRow: {
      flexDirection: 'row',
      gap: theme.spacing.space12,
      marginTop: theme.spacing.space4
    },
    errorText: {
      ...theme.typography.meta,
      color: theme.color.status.danger
    },
    placeholder: {
      minHeight: 240,
      paddingVertical: theme.spacing.space48,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8
    },
    placeholderText: {
      ...theme.typography.body,
      color: theme.color.text.secondary
    },
    footerHint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space8,
      paddingTop: theme.spacing.space8
    },
    footerHintText: {
      flex: 1,
      ...theme.typography.meta,
      color: theme.color.text.tertiary
    }
  })
}
