import { Platform, StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createNewWorktreeModalStyles(theme: MobileTheme) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: theme.spacing.space4,
      marginBottom: theme.spacing.space16
    },
    title: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary
    },
    loadingContainer: {
      paddingVertical: theme.spacing.space24,
      alignItems: 'center'
    },
    emptyText: {
      ...theme.typography.body,
      color: theme.color.text.secondary
    },
    field: {
      marginBottom: theme.spacing.space16
    },
    label: {
      ...theme.typography.meta,
      fontWeight: '500',
      color: theme.color.text.secondary,
      marginBottom: theme.spacing.space8
    },
    fieldButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: Platform.OS === 'ios' ? theme.spacing.space12 : theme.spacing.space8,
      borderWidth: 1,
      borderColor: theme.color.border.default
    },
    fieldButtonText: {
      ...theme.typography.body,
      flex: 1,
      color: theme.color.text.primary
    },
    repoDot: {
      width: 8,
      height: 8,
      borderRadius: theme.radii.circle
    },
    disabled: {
      opacity: 0.5
    },
    controlPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    sshBox: {
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      gap: theme.spacing.space8
    },
    sshRow: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12
    },
    sshDot: {
      width: 8,
      height: 8,
      borderRadius: theme.radii.circle
    },
    sshDotConnected: {
      backgroundColor: theme.color.status.success
    },
    sshDotProgress: {
      backgroundColor: theme.color.status.warning
    },
    sshDotDisconnected: {
      backgroundColor: theme.color.status.danger
    },
    sshCopy: {
      flex: 1,
      minWidth: 0
    },
    sshTitle: {
      ...theme.typography.body,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    sshSubtitle: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    sshConnectButton: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      paddingHorizontal: theme.spacing.space12
    },
    sshConnectText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    errorInline: {
      ...theme.typography.caption,
      color: theme.color.status.dangerText
    },
    input: {
      minHeight: theme.size.minimumTouchTarget,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: Platform.OS === 'ios' ? theme.spacing.space12 : theme.spacing.space8,
      ...theme.typography.body,
      borderWidth: 1,
      borderColor: theme.color.border.default
    },
    error: {
      ...theme.typography.meta,
      color: theme.color.status.dangerText,
      marginBottom: theme.spacing.space16
    },
    sourceWarning: {
      ...theme.typography.caption,
      marginTop: -theme.spacing.space8,
      marginBottom: theme.spacing.space16,
      color: theme.color.status.warningText
    },
    advancedToggle: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: theme.spacing.space8,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space8,
      marginLeft: -theme.spacing.space8,
      marginBottom: theme.spacing.space4
    },
    advancedText: {
      ...theme.typography.label,
      fontWeight: '500',
      color: theme.color.text.secondary
    },
    setupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.space8
    },
    sourceBadge: {
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.small,
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4
    },
    sourceBadgeText: {
      ...theme.typography.caption,
      fontWeight: '600',
      color: theme.color.text.tertiary,
      letterSpacing: 0.5
    },
    setupBox: {
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      padding: theme.spacing.space12
    },
    setupToggleRow: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.space8
    },
    setupToggleLabel: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    setupChoiceRow: {
      flexDirection: 'row',
      gap: theme.spacing.space8,
      marginBottom: theme.spacing.space8
    },
    setupChoiceButton: {
      minHeight: theme.size.minimumTouchTarget,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12
    },
    setupChoiceButtonSelected: {
      backgroundColor: theme.color.bg.selected,
      borderColor: theme.color.bg.selected
    },
    setupChoiceText: {
      ...theme.typography.label,
      fontWeight: '600',
      color: theme.color.text.primary
    },
    setupChoiceTextSelected: {
      color: theme.color.text.inverse
    },
    setupSwitch: {
      transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }]
    },
    setupCommandBlock: {
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.small,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8
    },
    setupCommand: {
      ...theme.typography.code,
      color: theme.color.text.primary
    },
    actions: {
      marginTop: theme.spacing.space12
    },
    createButton: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.bg.selected,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      borderRadius: theme.radii.control
    },
    createButtonDisabled: {
      opacity: 0.4
    },
    createButtonPressed: {
      opacity: 0.72
    },
    createText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    }
  })
}
