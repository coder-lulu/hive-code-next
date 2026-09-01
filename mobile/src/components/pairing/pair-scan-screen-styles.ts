import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../../theme/mobile-theme'

export function createPairScanScreenStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.color.bg.canvas },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space16
    },
    scrollCentered: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space24
    },
    scannerContent: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.space20,
      paddingTop: 0
    },
    cameraStage: {
      width: '100%',
      maxWidth: 400,
      minHeight: 470,
      alignItems: 'center',
      justifyContent: 'center'
    },
    cameraWrap: {
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    cameraPlaceholder: { flex: 1, backgroundColor: theme.color.bg.subtle },
    camera: { ...StyleSheet.absoluteFillObject },
    reticle: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center'
    },
    reticleFrame: { position: 'relative' },
    corner: {
      position: 'absolute',
      width: theme.spacing.space16,
      height: theme.spacing.space16,
      borderColor: theme.color.brand.primary
    },
    cornerTL: {
      top: 0,
      left: 0,
      borderTopWidth: 3,
      borderLeftWidth: 3,
      borderTopLeftRadius: theme.radii.small
    },
    cornerTR: {
      top: 0,
      right: 0,
      borderTopWidth: 3,
      borderRightWidth: 3,
      borderTopRightRadius: theme.radii.small
    },
    cornerBL: {
      bottom: 0,
      left: 0,
      borderBottomWidth: 3,
      borderLeftWidth: 3,
      borderBottomLeftRadius: theme.radii.small
    },
    cornerBR: {
      right: 0,
      bottom: 0,
      borderRightWidth: 3,
      borderBottomWidth: 3,
      borderBottomRightRadius: theme.radii.small
    },
    scanTitle: {
      ...theme.typography.pageTitle,
      color: theme.color.text.primary,
      textAlign: 'center',
      marginTop: theme.spacing.space20
    },
    scanDescription: {
      ...theme.typography.meta,
      maxWidth: 340,
      color: theme.color.text.secondary,
      textAlign: 'center',
      marginTop: theme.spacing.space8
    },
    actions: { width: '100%', gap: theme.spacing.space8, marginTop: theme.spacing.space24 },
    bottomActions: { width: '100%', maxWidth: 400 },
    scanStatus: {
      width: '100%',
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space12
    },
    scanStatusText: { ...theme.typography.label, color: theme.color.text.inverse },
    logSlot: { width: '100%', marginTop: theme.spacing.space20 }
  })
}
