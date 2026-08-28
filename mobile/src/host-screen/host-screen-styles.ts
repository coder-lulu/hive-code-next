import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

/**
 * Shared chrome styles for the host workspace list.
 *
 * This screen is rendered both as a phone route and as the persistent tablet
 * sidebar, so the styles intentionally avoid fixed widths and let the parent
 * layout provide the available space.
 */
export function createHostScreenStyles(theme: MobileTheme) {
  const { color, spacing, typography } = theme
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: color.bg.canvas },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.space24 },
    errorText: { color: color.status.danger, fontSize: 14, textAlign: 'center' },
    topChrome: { backgroundColor: color.bg.surface },
    statusBar: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space12,
      gap: spacing.space8
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 18
    },
    hostIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.space8 },
    hostNameText: { flexShrink: 1, color: color.text.primary, fontSize: 16, fontWeight: '600' },
    reconnectButton: {
      paddingHorizontal: spacing.space12,
      paddingVertical: spacing.space8,
      borderRadius: spacing.space8,
      backgroundColor: color.brand.primary
    },
    reconnectButtonText: { color: color.text.inverse, fontSize: 13, fontWeight: '600' },
    floatingWorkspaceHeaderButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: spacing.space8
    },
    sidebarCollapseButton: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: spacing.space8
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
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: spacing.space8
    },
    toolbar: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space12,
      paddingBottom: spacing.space8,
      gap: spacing.space8
    },
    toolbarSpacer: { flex: 1 },
    toolbarIconDisabled: { opacity: 0.45 },
    filterChip: {
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space12,
      gap: spacing.space4,
      borderWidth: 1,
      borderColor: color.border.subtle,
      borderRadius: 17,
      backgroundColor: color.bg.elevated
    },
    filterChipActive: { backgroundColor: color.bg.selected, borderColor: color.bg.selected },
    filterChipText: { color: color.text.secondary, fontSize: 13 },
    filterChipTextActive: { color: color.text.inverse, fontWeight: '600' },
    modeButton: {
      minHeight: 34,
      maxWidth: 150,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space12,
      gap: spacing.space4,
      borderWidth: 1,
      borderColor: color.border.subtle,
      borderRadius: 17,
      backgroundColor: color.bg.elevated
    },
    sortLabel: { flexShrink: 1, color: color.text.secondary, fontSize: 13 },
    searchToggle: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 17,
      backgroundColor: color.bg.elevated
    },
    searchBar: { paddingHorizontal: spacing.space12, paddingBottom: spacing.space8 },
    list: { paddingHorizontal: spacing.space12, paddingTop: spacing.space8 },
    sectionHeader: {
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space8,
      marginTop: spacing.space8,
      gap: spacing.space4
    },
    sectionIcon: { marginRight: 2 },
    sectionRepoIcon: { width: 20, alignItems: 'center' },
    sectionTitle: { flex: 1, color: color.text.secondary, fontSize: 13, fontWeight: '600' },
    sectionCount: { color: color.text.tertiary, fontSize: 12 },
    separator: { height: 1, backgroundColor: color.border.subtle },
    filterModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.space16
    },
    filterModalTitle: { ...typography.sectionTitle, color: color.text.primary },
    clearFiltersText: { color: color.brand.primary, fontSize: 13, fontWeight: '600' },
    filterSectionLabel: {
      marginBottom: spacing.space8,
      color: color.text.tertiary,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase'
    },
    filterGroup: {
      marginBottom: spacing.space16,
      overflow: 'hidden',
      borderRadius: spacing.space8,
      backgroundColor: color.bg.elevated
    },
    filterRow: {
      minHeight: 46,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space12,
      gap: spacing.space8
    },
    filterRowText: { flex: 1, color: color.text.primary, fontSize: 14 },
    filterSeparator: {
      height: 1,
      marginLeft: spacing.space12,
      backgroundColor: color.border.subtle
    },
    filterRepoDot: { width: 8, height: 8, borderRadius: 4 },
    confirmContent: { paddingHorizontal: spacing.space12, paddingTop: spacing.space12 },
    confirmTitle: {
      ...typography.sectionTitle,
      color: color.text.primary,
      marginBottom: spacing.space8
    },
    confirmMessage: { color: color.text.secondary, fontSize: 14, lineHeight: 20 },
    confirmButtons: { flexDirection: 'row', gap: spacing.space8, padding: spacing.space12 },
    confirmBtn: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: spacing.space8
    },
    confirmBtnCancel: { backgroundColor: color.bg.elevated },
    confirmBtnDestructive: { backgroundColor: color.status.danger },
    confirmBtnCancelText: { color: color.text.primary, fontSize: 14, fontWeight: '600' },
    confirmBtnDestructiveText: { color: color.text.inverse, fontSize: 14, fontWeight: '600' },
    confirmBtnPressed: { opacity: 0.75 }
  })
}
