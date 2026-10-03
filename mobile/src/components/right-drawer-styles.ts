import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createRightDrawerStyles(theme: MobileTheme) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 1000
    },
    root: { flex: 1 },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.color.overlay
    },
    anchor: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'flex-end'
    },
    drawer: {
      height: '100%',
      overflow: 'hidden',
      paddingLeft: theme.spacing.space12,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.color.border.default,
      borderTopLeftRadius: theme.radii.overlay,
      borderBottomLeftRadius: theme.radii.overlay,
      backgroundColor: theme.color.bg.surface
    }
  })
}
