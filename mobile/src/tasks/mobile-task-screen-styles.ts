import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { createMobileTaskScreenPalette } from './mobile-task-screen-colors'
import { createMobileTaskScreenCollectionStyles } from './mobile-task-screen-collection-styles'
import { createMobileTaskScreenRedesignStyles } from './mobile-task-screen-redesign-styles'

export {
  createMobileTaskCompatColors,
  createMobileTaskScreenPalette
} from './mobile-task-screen-colors'

export function createMobileTaskScreenStyles(theme: MobileTheme) {
  const palette = createMobileTaskScreenPalette(theme)
  const screenStyles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.canvas
    },
    topChrome: {
      backgroundColor: palette.canvas,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.borderSubtle
    },
    statusBar: {
      height: theme.size.navigationBarHeight,
      paddingHorizontal: theme.spacing.space20,
      flexDirection: 'row',
      alignItems: 'center'
    },
    headerSide: {
      width: theme.size.minimumTouchTarget * 2 + theme.spacing.space4,
      flexDirection: 'row',
      alignItems: 'center'
    },
    headerActions: {
      justifyContent: 'flex-end'
    },
    titleWrap: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      justifyContent: 'center'
    },
    title: {
      ...theme.typography.pageTitle,
      color: palette.textPrimary,
      textAlign: 'center'
    },
    connectionStatus: {
      minHeight: theme.typography.caption.lineHeight,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: theme.spacing.space4
    },
    connectionStatusText: {
      ...theme.typography.caption,
      color: palette.textSecondary
    },
    providerTabsScroll: {
      flexGrow: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.borderSubtle
    },
    providerTabs: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: theme.spacing.space24,
      paddingHorizontal: theme.spacing.space20
    },
    providerTab: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      borderBottomWidth: theme.spacing.space4 / 2,
      borderBottomColor: 'transparent'
    },
    providerTabSelected: {
      borderBottomColor: palette.selected
    },
    providerTabPressed: {
      backgroundColor: palette.subtle
    },
    providerTabText: {
      ...theme.typography.label,
      color: palette.textSecondary
    },
    providerTabTextSelected: {
      color: palette.textPrimary,
      fontWeight: theme.typography.sectionTitle.fontWeight
    },
    toolbarScroll: {
      maxHeight: theme.size.minimumTouchTarget + theme.spacing.space12
    },
    toolbar: {
      minHeight: theme.size.minimumTouchTarget + theme.spacing.space12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space8
    },
    filterButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space12,
      borderWidth: 1,
      borderColor: palette.borderDefault,
      borderRadius: theme.radii.control,
      backgroundColor: palette.surface
    },
    filterButtonPressed: {
      backgroundColor: palette.subtle
    },
    filterButtonActive: {
      borderColor: palette.brand,
      backgroundColor: palette.subtle
    },
    filterIconButton: {
      width: theme.spacing.space48,
      justifyContent: 'center',
      paddingHorizontal: 0
    },
    filterText: {
      ...theme.typography.meta,
      color: palette.textSecondary
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space20,
      paddingBottom: theme.spacing.space16
    },
    searchField: {
      minWidth: 0,
      minHeight: theme.spacing.space48,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingLeft: theme.spacing.space12,
      paddingRight: theme.spacing.space4,
      borderWidth: 1,
      borderColor: palette.borderDefault,
      borderRadius: theme.radii.control,
      backgroundColor: palette.surface
    },
    searchFieldFocused: {
      borderColor: palette.brand
    },
    searchInput: {
      ...theme.typography.body,
      flex: 1,
      minWidth: 0,
      margin: 0,
      padding: 0,
      color: palette.textPrimary,
      includeFontPadding: false,
      textAlignVertical: 'center'
    },
    clearButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    clearButtonPressed: {
      backgroundColor: palette.subtle
    },
    listHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space24,
      paddingBottom: theme.spacing.space8
    },
    listHeadingTitle: {
      ...theme.typography.sectionTitle,
      color: palette.textPrimary
    },
    listHeadingCount: {
      ...theme.typography.meta,
      color: palette.textSecondary
    },
    list: {
      marginHorizontal: theme.spacing.space20,
      marginBottom: theme.spacing.space20,
      paddingTop: 0,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: palette.borderDefault,
      borderRadius: theme.radii.card,
      backgroundColor: palette.surface
    },
    taskRow: {
      minHeight: theme.size.groupedListRowMinHeight + theme.spacing.space24,
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      backgroundColor: palette.surface
    },
    taskRowPressed: {
      backgroundColor: palette.subtle
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: theme.spacing.space48,
      marginRight: theme.spacing.space16,
      backgroundColor: palette.borderSubtle
    },
    taskTitle: {
      ...theme.typography.sectionTitle,
      flex: 1,
      color: palette.textPrimary
    },
    taskMeta: {
      ...theme.typography.meta,
      color: palette.textSecondary
    },
    taskCode: {
      ...theme.typography.code,
      color: palette.textSecondary
    },
    statusPill: {
      maxWidth: '40%',
      minHeight: theme.spacing.space24,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space8,
      borderWidth: 1,
      borderColor: palette.borderDefault,
      borderRadius: theme.radii.circle,
      backgroundColor: palette.subtle
    },
    statusText: {
      ...theme.typography.caption,
      color: palette.textSecondary
    },
    sectionHeader: {
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8,
      backgroundColor: palette.subtle
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space32
    },
    emptyText: {
      ...theme.typography.body,
      color: palette.textSecondary,
      textAlign: 'center'
    },
    centeredHint: {
      ...theme.typography.meta,
      marginTop: theme.spacing.space8,
      color: palette.textTertiary,
      textAlign: 'center'
    },
    errorBanner: {
      marginHorizontal: theme.spacing.space20,
      marginTop: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      borderWidth: 1,
      borderColor: palette.danger,
      borderRadius: theme.radii.control,
      backgroundColor: palette.surface
    },
    errorText: {
      ...theme.typography.meta,
      color: palette.dangerText
    },
    noticeBanner: {
      marginHorizontal: theme.spacing.space20,
      marginTop: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      borderWidth: 1,
      borderColor: palette.warning,
      borderRadius: theme.radii.control,
      backgroundColor: palette.surface
    }
  })
  return {
    ...screenStyles,
    ...createMobileTaskScreenCollectionStyles(theme),
    ...createMobileTaskScreenRedesignStyles(theme)
  }
}
