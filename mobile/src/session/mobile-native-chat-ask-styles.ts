import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
export function createMobileNativeChatAskStyles(theme: MobileTheme) {
  return StyleSheet.create({
    questionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space8 },
    card: {
      maxHeight: 380,
      backgroundColor: theme.color.bg.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    tabs: {
      flexGrow: 0,
      paddingTop: theme.spacing.space8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    tabsContent: {
      paddingHorizontal: theme.spacing.space8,
      gap: theme.spacing.space4,
      alignItems: 'center'
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent'
    },
    tabActive: {
      borderBottomColor: theme.color.brand.primary
    },
    tabText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    tabTextActive: {
      color: theme.color.text.primary
    },
    scroll: {
      paddingHorizontal: theme.spacing.space12
    },
    questionText: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary,
      fontWeight: '600',
      marginVertical: theme.spacing.space8
    },
    option: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      padding: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.elevated,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      marginBottom: theme.spacing.space4
    },
    optionSelected: {
      borderColor: theme.color.brand.primary
    },
    pressed: {
      opacity: 0.72
    },
    check: {
      width: theme.spacing.space20,
      height: theme.spacing.space20,
      borderWidth: 1.5,
      borderColor: theme.color.text.tertiary,
      alignItems: 'center',
      justifyContent: 'center'
    },
    checkCircle: {
      borderRadius: theme.radii.circle
    },
    checkSquare: {
      borderRadius: theme.radii.small
    },
    checkOn: {
      backgroundColor: theme.color.brand.primary,
      borderColor: theme.color.brand.primary
    },
    optionBody: {
      flex: 1,
      gap: theme.spacing.space4
    },
    optionLabel: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    optionDescription: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    input: {
      ...theme.typography.body,
      fontSize: TEXT_INPUT_FONT_SIZE,
      backgroundColor: theme.color.bg.elevated,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      color: theme.color.text.primary,
      padding: theme.spacing.space12,
      minHeight: theme.size.minimumTouchTarget,
      marginBottom: theme.spacing.space4
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing.space12,
      gap: theme.spacing.space8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    cancel: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space8
    },
    cancelText: {
      ...theme.typography.label,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    progress: {
      ...theme.typography.meta,
      color: theme.color.text.tertiary
    },
    next: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    nextDisabled: {
      backgroundColor: theme.color.bg.subtle
    },
    nextText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    nextTextDisabled: {
      color: theme.color.text.tertiary
    }
  })
}
