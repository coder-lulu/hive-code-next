import { StyleSheet } from 'react-native'

export function createTerminalWebViewFrameStyles(backgroundColor: string) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor
    },
    webview: {
      flex: 1,
      backgroundColor
    }
  })
}
