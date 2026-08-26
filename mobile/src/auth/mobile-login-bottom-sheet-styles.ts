import { Platform, StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileLoginBottomSheetStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, justifyContent: 'flex-end' },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.color.overlay
    },
    sheet: {
      overflow: 'hidden',
      backgroundColor: theme.color.bg.surface,
      borderTopLeftRadius: theme.radii.overlay,
      borderTopRightRadius: theme.radii.overlay,
      ...Platform.select({
        ios: {
          shadowColor: theme.color.text.primary,
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.08,
          shadowRadius: 10
        },
        android: { elevation: 6 }
      })
    },
    handleArea: { height: 24, alignItems: 'center', justifyContent: 'center' },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.color.border.default
    },
    closeButton: {
      position: 'absolute',
      top: theme.spacing.space12,
      right: theme.spacing.space12,
      zIndex: 2,
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    closePressed: { backgroundColor: theme.color.bg.subtle },
    content: {
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space32
    },
    scroll: { flexShrink: 1 },
    brandRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingRight: theme.spacing.space40
    },
    brandCopy: { minWidth: 0, flex: 1 },
    title: { ...theme.typography.pageTitle, color: theme.color.text.primary },
    subtitle: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    actions: { gap: theme.spacing.space12, marginTop: theme.spacing.space24 },
    actionButton: {
      width: '100%',
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space16
    },
    primaryButton: { backgroundColor: theme.color.bg.selected },
    secondaryButton: {
      minHeight: 44,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface
    },
    actionPressed: { opacity: 0.72 },
    actionDisabled: { opacity: 0.4 },
    registrationHint: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      textAlign: 'center',
      marginTop: theme.spacing.space4
    },
    primaryLabel: { ...theme.typography.body, fontWeight: '600', color: theme.color.text.inverse },
    secondaryLabel: {
      ...theme.typography.body,
      fontWeight: '500',
      color: theme.color.text.primary
    },
    securityLine: {
      minHeight: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space16
    },
    securityText: { ...theme.typography.meta, color: theme.color.text.secondary },
    providerSection: { marginTop: theme.spacing.space24 },
    providerHeading: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space12 },
    providerRule: {
      height: StyleSheet.hairlineWidth,
      flex: 1,
      backgroundColor: theme.color.border.default
    },
    providerTitle: {
      ...theme.typography.meta,
      fontWeight: '500',
      color: theme.color.text.secondary
    },
    providerGrid: {
      maxWidth: 252,
      alignSelf: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: theme.spacing.space20,
      marginTop: theme.spacing.space16
    },
    providerButton: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    providerPressed: { backgroundColor: theme.color.bg.subtle },
    agreementRow: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginTop: theme.spacing.space24
    },
    checkboxHitArea: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
      paddingTop: theme.spacing.space4
    },
    checkbox: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: theme.color.text.secondary,
      borderRadius: theme.radii.small,
      backgroundColor: theme.color.bg.surface
    },
    checkboxChecked: {
      borderColor: theme.color.bg.selected,
      backgroundColor: theme.color.bg.selected
    },
    agreementText: {
      ...theme.typography.caption,
      minWidth: 0,
      flex: 1,
      color: theme.color.text.secondary,
      paddingTop: theme.spacing.space4
    },
    agreementLink: { color: theme.color.brand.primary }
  })
}
