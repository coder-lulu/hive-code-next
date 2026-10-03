import { memo, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { darkTheme, type MobileTheme } from '../../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'
import { mermaidDiagramConfig } from './mermaid-diagram-config'
import { MERMAID_ENGINE_JS } from './mermaid-webview-engine.generated'

export type MermaidDiagramProps = {
  source: string
  base: number
}

// Renders a ```mermaid fence as a diagram via a sandboxed WebView (mermaid has no
// native RN renderer). Mermaid ships inside the app as a generated bundle embedded
// in the WebView HTML — no network — the SVG is themed dark to match the sidebar,
// and the WebView posts back its rendered height so we can size to content. On any
// failure (parse error, render error) we fall back to the raw source in a labeled
// mono code box.
// memo: both props are primitives; without it every mounted diagram re-renders
// per frame during pinch-to-zoom (textScale updates), marshalling the full HTML
// string across the Fabric boundary each time.
export const MermaidDiagram = memo(function MermaidDiagram({ source, base }: MermaidDiagramProps) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMermaidDiagramStyles)
  const [height, setHeight] = useState(0)
  const [failed, setFailed] = useState(false)
  const html = useMemo(() => buildHtml(source, theme), [source, theme])

  if (failed) {
    return <MermaidFallback source={source} base={base} />
  }

  return (
    <View style={styles.frame}>
      <View style={styles.label}>
        <Text style={styles.labelText}>mermaid</Text>
      </View>
      <WebView
        style={[styles.webview, { height: height || 120 }]}
        originWhitelist={['*']}
        source={{ html }}
        javaScriptEnabled
        scrollEnabled={false}
        // Diagram is self-contained; any navigation attempt means something is
        // wrong, so treat it as a render failure and fall back to source.
        onShouldStartLoadWithRequest={(request) => {
          if (request.url === 'about:blank' || request.url.startsWith('data:')) {
            return true
          }
          setFailed(true)
          return false
        }}
        onError={() => setFailed(true)}
        onHttpError={() => setFailed(true)}
        onMessage={(event) => {
          const data = event.nativeEvent.data
          if (data === 'error') {
            setFailed(true)
            return
          }
          const parsed = Number(data)
          if (Number.isFinite(parsed) && parsed > 0) {
            setHeight(Math.ceil(parsed))
          }
        }}
      />
    </View>
  )
})

function MermaidFallback({ source, base }: MermaidDiagramProps) {
  const styles = useMobileThemeStyles(createMermaidDiagramStyles)
  return (
    <View style={styles.frame}>
      <View style={styles.label}>
        <Text style={styles.labelText}>mermaid</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fallbackScroll}>
        <Text style={[styles.fallbackText, { fontSize: base - 1 }]}>{source}</Text>
      </ScrollView>
    </View>
  )
}

// JSON.stringify escapes quotes and control chars but leaves `<`, `>`, `&`, and
// the U+2028/U+2029 line separators raw — so a value containing `</script>` would
// close the inline <script> this is spliced into and let the rest execute as
// markup. These characters only ever appear inside JSON string literals, so
// escaping them to \uXXXX is always valid and always parses back to the exact
// original text inside the WebView.
function encodeJsonForScript(json: string): string {
  return json.replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
}

// Diagram source is untrusted: agent output, PR and chat content.
function encodeSourceForScript(source: string): string {
  return encodeJsonForScript(JSON.stringify(source))
}

// The config is not untrusted, but it is not a closed set of hex colours either: a
// themeCSS or a font stack is free text, and it goes into the same script element.
function encodeConfigForScript(theme: MobileTheme): string {
  return encodeJsonForScript(JSON.stringify(mermaidDiagramConfig(theme)))
}

// Self-contained HTML: embedded mermaid bundle, render the graph, post the body
// height (or "error") back to RN. Theme variables match the dark sidebar palette.
export function buildHtml(source: string, theme: MobileTheme = darkTheme): string {
  const encoded = encodeSourceForScript(source)
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'" />
<style>
  html, body { margin: 0; padding: 0; background: ${theme.color.bg.subtle}; }
  #c { padding: 8px; }
  #c svg { max-width: 100%; height: auto; }
</style>
<script>${MERMAID_ENGINE_JS}</script>
</head>
<body>
<div id="c"><pre class="mermaid"></pre></div>
<script>
  function post(msg) {
    if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(String(msg)); }
  }
  function reportHeight() {
    post(document.getElementById('c').scrollHeight);
  }
  try {
    document.querySelector('.mermaid').textContent = ${encoded};
    mermaid.initialize(${encodeConfigForScript(theme)});
    mermaid.run({ querySelector: '.mermaid' })
      .then(function () { reportHeight(); })
      .catch(function () { post('error'); });
  } catch (e) {
    post('error');
  }
</script>
</body>
</html>`
}

export function createMermaidDiagramStyles(theme: MobileTheme) {
  return StyleSheet.create({
    frame: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.control,
      marginBottom: theme.spacing.space8,
      overflow: 'hidden',
      backgroundColor: theme.color.bg.subtle
    },
    label: {
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    labelText: {
      color: theme.color.text.secondary,
      fontSize: 11,
      fontFamily: theme.typography.code.fontFamily
    },
    webview: { backgroundColor: theme.color.bg.subtle },
    fallbackScroll: { padding: theme.spacing.space8 },
    fallbackText: {
      color: theme.color.text.primary,
      fontFamily: theme.typography.code.fontFamily
    }
  })
}
