import { WebView } from 'react-native-webview'
import { mobileMediaPreviewDocument } from './mobile-media-preview-document'
import { createFilePreviewStyles } from './mobile-file-preview-styles'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'

export type MobileMediaPlaybackProps = { uri: string; mimeType: string; title: string }

export function MobileMediaPlayback({ uri, mimeType, title }: MobileMediaPlaybackProps) {
  const styles = useMobileThemeStyles(createFilePreviewStyles)
  return (
    <WebView
      style={styles.container}
      source={{ html: mobileMediaPreviewDocument(uri, mimeType, title), baseUrl: uri }}
      originWhitelist={['about:blank', 'file://*']}
      allowingReadAccessToURL={uri}
      allowFileAccess
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mediaPlaybackRequiresUserAction
      allowsInlineMediaPlayback
      allowsFullscreenVideo
      onShouldStartLoadWithRequest={({ url }) => url === 'about:blank' || url === uri}
    />
  )
}
