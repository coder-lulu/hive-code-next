import {
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useEffect,
  useMemo,
  useState
} from 'react'
import { ActivityIndicator, Platform, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { darkTheme } from '../theme/mobile-theme'
import type { TerminalWebViewHandle, TerminalWebViewProps } from './terminal-webview-contract'
import { TerminalWebViewEngineErrorOverlay } from './terminal-webview-engine-error-state'
import { createTerminalWebViewFrameStyles } from './terminal-webview-frame-styles'
import { xtermWebViewSource } from './terminal-webview-html'
import type { TerminalWebViewCommand } from './terminal-webview-messages'
import { useTerminalWebViewController } from './use-terminal-webview-controller'

type Props = TerminalWebViewProps

export type { TerminalWebViewHandle } from './terminal-webview-contract'

export const TerminalWebView = forwardRef<TerminalWebViewHandle, Props>(
  function TerminalWebView(props, ref) {
    const webViewRef = useRef<WebView>(null)
    const [hasPaintedContent, setHasPaintedContent] = useState(false)
    const [showLoading, setShowLoading] = useState(false)
    const foreground = props.terminalTheme?.theme.foreground ?? darkTheme.terminal.foreground
    const background = props.terminalTheme?.theme.background ?? darkTheme.terminal.background
    const frameStyles = useMemo(() => createTerminalWebViewFrameStyles(background), [background])

    useEffect(() => {
      if (hasPaintedContent) {
        return
      }
      const timer = setTimeout(() => setShowLoading(true), 300)
      return () => clearTimeout(timer)
    }, [hasPaintedContent])

    const post = useCallback((command: TerminalWebViewCommand & { id: number }) => {
      webViewRef.current?.postMessage(JSON.stringify(command))
    }, [])

    const {
      clearEngineError,
      engineError,
      handle,
      receive,
      reportNativeEngineError,
      resetReadiness
    } = useTerminalWebViewController(props, {
      post,
      // iOS can preserve the native view while discarding its JS/backing-store state.
      pingsOnForegroundRecovery: () => Platform.OS === 'ios'
    })

    useImperativeHandle(ref, () => handle, [handle])
    // Why: the document builds its terminal before ready, so it needs the text scale before any
    // message can reach it; later changes arrive as set-font-scale.
    // Why: in the page source rather than injected: Android can run an injected script after the
    // document's own, which then starts without them.
    const [source] = useState(() =>
      xtermWebViewSource({ textScale: props.textScale ?? 1, shown: props.shownAtMount ?? true })
    )

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>
        } catch {
          return
        }
        if (msg.type === 'ready') {
          setHasPaintedContent(true)
          setShowLoading(false)
        }
        receive(msg)
      },
      [receive]
    )

    const handleReload = useCallback(() => {
      clearEngineError()
      webViewRef.current?.reload()
    }, [clearEngineError])

    const handleLoadStart = useCallback(() => {
      setHasPaintedContent(false)
      setShowLoading(false)
      resetReadiness()
    }, [resetReadiness])

    const handleContentProcessDidTerminate = useCallback(() => {
      // Why: WKWebView content-process loss is recoverable; stale commands belong
      // to the dead document and the replacement must prove readiness before replay.
      setHasPaintedContent(false)
      setShowLoading(false)
      resetReadiness()
      clearEngineError()
      webViewRef.current?.reload()
    }, [clearEngineError, resetReadiness])

    return (
      <View style={[frameStyles.container, props.style]}>
        <WebView
          ref={webViewRef}
          source={source}
          style={frameStyles.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          scrollEnabled={false}
          // Why: Android parent gesture containers can intercept vertical drags
          // before the injected xterm scroll router sees them.
          nestedScrollEnabled
          scalesPageToFit={false}
          // Why: Android WebView defaults textZoom to the system font scale, inflating
          // xterm's DOM glyphs past its canvas-measured cell grid (#4579). iOS ignores it.
          textZoom={100}
          onLoadStart={handleLoadStart}
          onMessage={handleMessage}
          onError={(event) => reportNativeEngineError('Terminal WebView load failed', event)}
          onHttpError={(event) => reportNativeEngineError('Terminal WebView HTTP error', event)}
          onRenderProcessGone={(event) =>
            reportNativeEngineError('Terminal WebView render process ended', event)
          }
          onContentProcessDidTerminate={handleContentProcessDidTerminate}
        />
        {!engineError && !hasPaintedContent && showLoading ? (
          <View style={frameStyles.loadingOverlay} accessibilityLiveRegion="polite">
            <ActivityIndicator color={foreground} />
            <Text style={[frameStyles.loadingText, { color: foreground }]}>正在加载会话内容…</Text>
          </View>
        ) : null}
        {engineError ? (
          <TerminalWebViewEngineErrorOverlay
            message={engineError}
            terminalTheme={props.terminalTheme}
            onReload={handleReload}
          />
        ) : null}
      </View>
    )
  }
)
