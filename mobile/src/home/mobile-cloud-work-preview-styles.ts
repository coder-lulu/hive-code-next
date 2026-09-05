import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileCloudWorkPreviewStyles(theme: MobileTheme, compact: boolean) {
  const mascotSize = compact
    ? theme.spacing.space64 + theme.spacing.space16
    : theme.spacing.space64 + theme.spacing.space32
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.color.bg.canvas },
    content: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space16,
      paddingBottom: theme.spacing.space16
    },
    hero: {
      minHeight: mascotSize,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space12
    },
    heroCompact: { flexDirection: 'column', gap: theme.spacing.space8 },
    assistantVisual: { width: mascotSize, height: mascotSize },
    mascot: { width: mascotSize, height: mascotSize },
    heroCopy: { minWidth: 0, flex: 1, gap: theme.spacing.space8 },
    heroCopyCompact: { flex: 0, alignItems: 'center' },
    title: { ...theme.typography.pageTitle, color: theme.color.text.primary },
    subtitle: { ...theme.typography.body, color: theme.color.text.secondary },
    pressed: { backgroundColor: theme.color.bg.subtle },
    composerArea: {
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      paddingBottom: theme.spacing.space8,
      backgroundColor: theme.color.bg.canvas
    },
    notice: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.brand.subtle
    },
    noticeText: { ...theme.typography.caption, flex: 1, color: theme.color.text.secondary },
    composer: {
      gap: theme.spacing.space8,
      padding: theme.spacing.space8,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.overlay,
      backgroundColor: theme.color.bg.surface
    },
    composerFocused: { borderColor: theme.color.brand.primary },
    composerToolbar: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    toolbarSpacer: { minWidth: theme.spacing.space4, flex: 1 },
    composerIconButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control
    },
    composerControlDisabled: { opacity: 0.48 },
    composerPicker: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control
    },
    composerPickerText: { ...theme.typography.caption, color: theme.color.text.primary },
    inputRow: {
      minHeight: theme.spacing.space64 * 2,
      flexDirection: 'row',
      alignItems: 'flex-end'
    },
    input: {
      ...theme.typography.body,
      minWidth: 0,
      minHeight: theme.spacing.space64 * 2,
      maxHeight: theme.spacing.space64 * 2,
      flex: 1,
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space8,
      color: theme.color.text.primary,
      textAlignVertical: 'top'
    },
    sendButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    sendButtonDisabled: { backgroundColor: theme.color.bg.subtle },
    sendButtonPressed: { opacity: 0.76 },
    disclaimer: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      textAlign: 'center'
    },
    agentPickerTitle: {
      ...theme.typography.pageTitle,
      marginBottom: theme.spacing.space16,
      color: theme.color.text.primary
    },
    agentPickerGroup: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    agentPickerRow: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16
    },
    agentPickerRowSelected: { backgroundColor: theme.color.brand.subtle },
    agentPickerLabel: {
      ...theme.typography.body,
      minWidth: 0,
      flex: 1,
      color: theme.color.text.primary,
      fontWeight: '500'
    },
    agentPickerSeparator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: theme.spacing.space48,
      backgroundColor: theme.color.border.subtle
    }
  })
}

export type MobileCloudWorkPreviewStyles = ReturnType<typeof createMobileCloudWorkPreviewStyles>
