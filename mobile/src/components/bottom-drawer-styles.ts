import { Platform, StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createBottomDrawerStyles(theme: MobileTheme) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 1000
    },
    root: {
      flex: 1
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.color.overlay
    },
    backdropPressable: {
      ...StyleSheet.absoluteFillObject
    },
    anchor: {
      flex: 1,
      justifyContent: 'flex-end'
    },
    anchorWide: {
      alignItems: 'center'
    },
    drawer: {
      backgroundColor: theme.color.bg.surface,
      borderTopLeftRadius: theme.radii.overlay,
      borderTopRightRadius: theme.radii.overlay,
      paddingHorizontal: theme.spacing.space12,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: theme.scheme === 'dark' ? 0.32 : 0.14,
          shadowRadius: 10
        },
        android: { elevation: 8 }
      })
    },
    drawerFill: {
      // Why: flex children (results + dock) need a column height budget; without
      // this, fill height alone still leaves staticContent height content-sized.
      overflow: 'hidden',
      flexDirection: 'column'
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.color.border.default
    },
    handleHitArea: {
      alignItems: 'center',
      paddingTop: theme.spacing.space8,
      paddingBottom: theme.spacing.space12
    },
    staticContent: {
      minHeight: 0
    },
    staticContentFill: {
      flex: 1
    },
    bottomExtension: {
      position: 'absolute',
      bottom: -500,
      left: 0,
      right: 0,
      height: 500,
      backgroundColor: theme.color.bg.surface
    }
  })
}
