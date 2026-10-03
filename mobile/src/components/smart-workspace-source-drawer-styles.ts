import { StyleSheet } from 'react-native'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
import type { MobileTheme } from '../theme/mobile-theme'

export function createSmartWorkspaceSourceDrawerStyles(theme: MobileTheme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      minHeight: 0
    },
    header: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: theme.spacing.space4,
      flexShrink: 0
    },
    title: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary
    },
    doneButton: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'flex-end',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space8
    },
    doneButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    done: {
      ...theme.typography.label,
      fontWeight: '600',
      color: theme.color.brand.primary
    },
    results: {
      flex: 1,
      minHeight: 0
    },
    list: {
      flex: 1,
      backgroundColor: theme.color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderTopLeftRadius: theme.radii.card,
      borderTopRightRadius: theme.radii.card,
      overflow: 'hidden'
    },
    listContent: {
      flexGrow: 1,
      paddingBottom: theme.spacing.space8
    },
    // Why: pin the dock to the sheet bottom so a flex-greedy FlatList cannot
    // push the TextInput out of the fill frame (and under the keyboard).
    dock: {
      flexShrink: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface,
      paddingTop: theme.spacing.space8,
      paddingBottom: theme.spacing.space8,
      gap: theme.spacing.space8,
      zIndex: 2
    },
    search: {
      minHeight: theme.size.minimumTouchTarget,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      ...theme.typography.body,
      fontSize: TEXT_INPUT_FONT_SIZE,
      borderWidth: 1,
      borderColor: theme.color.border.default
    },
    tabRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.space4
    },
    tab: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space12,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface
    },
    tabSelected: {
      backgroundColor: theme.color.bg.selected,
      borderColor: theme.color.bg.selected
    },
    tabText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    tabTextSelected: {
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.space4
    },
    chip: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface
    },
    chipSelected: {
      backgroundColor: theme.color.bg.selected,
      borderColor: theme.color.bg.selected
    },
    chipText: {
      ...theme.typography.caption,
      color: theme.color.text.secondary
    },
    chipTextSelected: {
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    crossRepo: {
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      padding: theme.spacing.space12,
      marginBottom: theme.spacing.space8,
      gap: theme.spacing.space12
    },
    crossRepoText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    crossRepoActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: theme.spacing.space8
    },
    crossRepoDismiss: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface
    },
    crossRepoDismissText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    crossRepoSwitch: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected,
      borderWidth: 1,
      borderColor: theme.color.bg.selected
    },
    crossRepoSwitchText: {
      ...theme.typography.meta,
      fontWeight: '600',
      color: theme.color.text.inverse
    },
    notice: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      paddingHorizontal: theme.spacing.space4,
      paddingBottom: theme.spacing.space8
    },
    errorNotice: {
      ...theme.typography.caption,
      color: theme.color.status.dangerText,
      paddingHorizontal: theme.spacing.space4,
      paddingBottom: theme.spacing.space8
    },
    loading: {
      paddingVertical: theme.spacing.space16,
      alignItems: 'center'
    },
    empty: {
      ...theme.typography.meta,
      paddingVertical: theme.spacing.space24,
      textAlign: 'center',
      color: theme.color.text.tertiary
    }
  })
}
