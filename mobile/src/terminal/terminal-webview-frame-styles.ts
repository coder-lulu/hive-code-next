import { StyleSheet } from 'react-native'
import { darkTheme } from '../theme/mobile-theme'

export function createTerminalWebViewFrameStyles(backgroundColor: string) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor
    },
    webview: {
      flex: 1,
      backgroundColor
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor,
      alignItems: 'center',
      justifyContent: 'center',
      gap: darkTheme.spacing.space12,
      padding: darkTheme.spacing.space24
    },
    loadingText: {
      ...darkTheme.typography.body,
      textAlign: 'center'
    }
  })
}
