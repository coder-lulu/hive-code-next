import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { createHostScreenRecoveryStyles } from './host-screen-recovery-styles'
import { createHostScreenViewPickerStyles } from './host-screen-view-picker-styles'

/**
 * Shared chrome styles for the host workspace list.
 * The parent provides the available width on phone routes and tablet sidebars.
 */
export function createHostScreenStyles(theme: MobileTheme) {
  const { color, radii, size, spacing, typography } = theme
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: color.bg.canvas },
    phoneChrome: { backgroundColor: color.bg.canvas },
    phoneHeaderRow: {
      minHeight: size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space16
    },
    phoneHeaderSide: { minWidth: 0, flex: 1 },
    phoneHeaderRight: { alignItems: 'flex-end' },
    phoneHeaderTitleWrap: { minWidth: 0, flex: 1, alignItems: 'center' },
    phoneHeaderTitle: { ...typography.pageTitle, color: color.text.primary },
    runtimeButton: {
      minWidth: 0,
      minHeight: size.minimumTouchTarget,
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: spacing.space4,
      paddingHorizontal: spacing.space8,
      borderRadius: radii.control
    },
    runtimeStatusDot: {
      width: spacing.space8,
      height: spacing.space8,
      flexShrink: 0,
      borderRadius: radii.circle
    },
    runtimeCopy: { minWidth: 0, flexShrink: 1 },
    runtimeButtonText: {
      ...typography.meta,
      minWidth: 0,
      flexShrink: 1,
      color: color.text.primary,
      fontWeight: '600'
    },
    runtimeStatusText: { ...typography.caption, color: color.text.secondary },
    runtimeStatusSuccess: { color: color.status.successText },
    runtimeStatusWarning: { color: color.status.warningText },
    runtimeStatusDanger: { color: color.status.dangerText },
    phoneIconButton: {
      width: size.minimumTouchTarget,
      height: size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.control
    },
    phoneIconButtonActive: { backgroundColor: color.brand.subtle },
    controlPressed: { backgroundColor: color.bg.subtle },
    phoneSearchBar: {
      paddingHorizontal: spacing.space16,
      paddingBottom: spacing.space12
    },
    workspaceSummary: {
      minHeight: spacing.space64 + spacing.space12,
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: spacing.space16,
      marginBottom: spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.subtle,
      borderRadius: radii.card,
      backgroundColor: color.bg.surface
    },
    workspaceSummaryItem: {
      minWidth: 0,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.space4,
      paddingHorizontal: spacing.space4
    },
    workspaceSummaryValueRow: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.space4
    },
    workspaceSummaryDivider: {
      width: StyleSheet.hairlineWidth,
      height: spacing.space40,
      backgroundColor: color.border.subtle
    },
    workspaceSummaryValue: {
      ...typography.sectionTitle,
      color: color.text.primary,
      fontVariant: ['tabular-nums']
    },
    workspaceSummaryLabel: { ...typography.caption, color: color.text.secondary },
    topChrome: { backgroundColor: color.bg.surface },
    statusBar: {
      minHeight: size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space12,
      gap: spacing.space8
    },
    backButton: {
      width: size.minimumTouchTarget,
      height: size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.circle
    },
    hostIdentity: { flex: 1, minWidth: 0, justifyContent: 'center' },
    hostIdentityLine: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.space8
    },
    hostPlatformText: {
      ...typography.meta,
      marginLeft: spacing.space16,
      color: color.text.secondary
    },
    hostNameText: {
      ...typography.sectionTitle,
      flexShrink: 1,
      color: color.text.primary
    },
    reconnectButton: {
      paddingHorizontal: spacing.space12,
      paddingVertical: spacing.space8,
      borderRadius: radii.control,
      backgroundColor: color.brand.primary
    },
    reconnectButtonText: { ...typography.meta, color: color.text.inverse, fontWeight: '600' },
    floatingWorkspaceHeaderButton: {
      width: size.minimumTouchTarget,
      height: size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.control
    },
    sidebarCollapseButton: {
      width: size.minimumTouchTarget,
      height: size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.control
    },
    embeddedToolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.space12,
      paddingBottom: spacing.space8,
      gap: spacing.space8
    },
    embeddedToolbarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space8 },
    embeddedFilterChip: { flexShrink: 1 },
    embeddedModeButton: { flexShrink: 1 },
    embeddedToolbarIconButton: {
      width: size.minimumTouchTarget,
      height: size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.control
    },
    toolbar: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space12,
      paddingBottom: spacing.space8,
      gap: spacing.space8
    },
    toolbarIconDisabled: { opacity: 0.45 },
    filterChip: {
      minHeight: size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space12,
      gap: spacing.space4,
      borderWidth: 1,
      borderColor: color.border.subtle,
      borderRadius: radii.circle,
      backgroundColor: color.bg.elevated
    },
    filterChipActive: { backgroundColor: color.bg.selected, borderColor: color.bg.selected },
    filterChipText: { ...typography.meta, color: color.text.secondary },
    filterChipTextActive: { color: color.text.inverse, fontWeight: '600' },
    modeButton: {
      minHeight: size.minimumTouchTarget,
      maxWidth: 150,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space12,
      gap: spacing.space4,
      borderWidth: 1,
      borderColor: color.border.subtle,
      borderRadius: radii.circle,
      backgroundColor: color.bg.elevated
    },
    sortLabel: { ...typography.meta, flexShrink: 1, color: color.text.secondary },
    searchToggle: {
      width: size.minimumTouchTarget,
      height: size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.circle,
      backgroundColor: color.bg.elevated
    },
    searchBar: { paddingHorizontal: spacing.space12, paddingBottom: spacing.space8 },
    workspaceList: { flex: 1 },
    list: { paddingHorizontal: spacing.space12, paddingTop: spacing.space8 },
    sectionHeader: {
      minHeight: size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space8,
      marginTop: spacing.space8,
      gap: spacing.space4
    },
    sectionIcon: { marginRight: 2 },
    sectionRepoIcon: { width: 20, alignItems: 'center' },
    sectionTitle: {
      ...typography.meta,
      flex: 1,
      color: color.text.secondary,
      fontWeight: '600'
    },
    sectionCount: { ...typography.caption, color: color.text.tertiary },
    separator: { height: 1, backgroundColor: color.border.subtle },
    confirmContent: { paddingHorizontal: spacing.space12, paddingTop: spacing.space12 },
    confirmTitle: {
      ...typography.sectionTitle,
      color: color.text.primary,
      marginBottom: spacing.space8
    },
    confirmMessage: { ...typography.label, color: color.text.secondary },
    confirmButtons: { flexDirection: 'row', gap: spacing.space8, padding: spacing.space12 },
    confirmBtn: {
      flex: 1,
      minHeight: size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.control
    },
    confirmBtnCancel: { backgroundColor: color.bg.elevated },
    confirmBtnDestructive: { backgroundColor: color.status.danger },
    confirmBtnCancelText: { ...typography.label, color: color.text.primary, fontWeight: '600' },
    confirmBtnDestructiveText: {
      ...typography.label,
      color: color.text.inverse,
      fontWeight: '600'
    },
    confirmBtnPressed: { opacity: 0.75 }
  })
  return {
    ...createHostScreenRecoveryStyles(theme),
    ...createHostScreenViewPickerStyles(theme),
    ...styles
  }
}
