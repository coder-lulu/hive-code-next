import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
import type { MobileFileMedia } from './mobile-file-media'
import { downloadMobileFileMedia, type MobileMediaSink } from './mobile-file-media-download'
import { createMobileMediaSink } from './mobile-media-preview-cache'
import { MobileMediaPlayback } from './MobileMediaPlayback'
import { createFilePreviewStyles } from './mobile-file-preview-styles'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { formatPreviewByteLength } from './mobile-file-preview-response'

type State = { uri: string } | { error: string } | { bytes: number; total: number }
type Props = { media: MobileFileMedia; client: MobileFilePreviewRpcSender | null; title: string }

export function MobileFileMediaPreview(props: Props) {
  const { worktreeId, relativePath, mimeType } = props.media
  return <MediaDownload key={JSON.stringify([worktreeId, relativePath, mimeType])} {...props} />
}

function MediaDownload({ media, client, title }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createFilePreviewStyles)
  const { worktreeId, relativePath, mimeType } = media
  const [state, setState] = useState<State>({ bytes: 0, total: 0 })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let sink: MobileMediaSink | null = null
    setState({ bytes: 0, total: 0 })
    if (client) {
      void (async () => {
        try {
          sink = createMobileMediaSink(relativePath, mimeType)
          const uri = await downloadMobileFileMedia(
            client,
            { worktreeId, relativePath, mimeType },
            sink,
            controller.signal,
            (bytes, total) => setState({ bytes, total })
          )
          if (!controller.signal.aborted) {
            setState({ uri })
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setState({ error: error instanceof Error ? error.message : 'Unable to load media' })
          }
        }
      })()
    }
    return () => {
      controller.abort()
      sink?.dispose()
    }
  }, [client, worktreeId, relativePath, mimeType, attempt])
  if (!client) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>正在等待工作主机…</Text>
      </View>
    )
  }
  if ('uri' in state) {
    return <MobileMediaPlayback key={state.uri} uri={state.uri} mimeType={mimeType} title={title} />
  }
  if ('error' in state) {
    return (
      <View style={styles.state}>
        <Text style={styles.errorText}>{state.error}</Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => setAttempt(attempt + 1)}
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </View>
    )
  }
  return (
    <View style={styles.state}>
      <ActivityIndicator color={theme.color.text.secondary} />
      <Text style={styles.stateText}>
        {state.total
          ? `Downloading ${formatPreviewByteLength(state.bytes)} of ${formatPreviewByteLength(state.total)}`
          : '正在加载媒体…'}
      </Text>
    </View>
  )
}
