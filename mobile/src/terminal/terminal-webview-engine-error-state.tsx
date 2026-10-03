import { useCallback, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { darkTheme } from '../theme/mobile-theme'
import type { MobileTerminalTheme } from './terminal-webview-contract'

export type NativeWebViewEngineEvent = {
  readonly nativeEvent?: object
}

type TerminalWebViewEngineErrorOverlayProps = {
  readonly message: string
  readonly terminalTheme?: MobileTerminalTheme
  readonly onReload: () => void
}

type NativeWebViewEngineFields = {
  readonly description?: unknown
  readonly code?: unknown
  readonly statusCode?: unknown
  readonly domain?: unknown
  readonly didCrash?: unknown
}

export function useTerminalWebViewEngineErrorState(onEngineError?: (message: string) => void) {
  const [engineError, setEngineError] = useState<string | null>(null)
  const clearEngineError = useCallback(() => setEngineError(null), [])
  const reportEngineError = useCallback(
    (message: string, fatal: boolean) => {
      onEngineError?.(message)
      // eslint-disable-next-line no-console
      console.warn('[terminal-webview] engine error', message)
      if (fatal) {
        // Why: the first fatal report is the root cause; later cascades (e.g. the
        // web-ready watchdog firing after a process-crash report) must not
        // overwrite its more specific diagnostics. clearEngineError resets.
        setEngineError((previous) => previous ?? message)
      }
    },
    [onEngineError]
  )
  const reportNativeEngineError = useCallback(
    (context: string, event?: NativeWebViewEngineEvent) => {
      reportEngineError(describeNativeWebViewEngineError(context, event), true)
    },
    [reportEngineError]
  )
  return { clearEngineError, engineError, reportEngineError, reportNativeEngineError }
}

export function describeNativeWebViewEngineError(
  context: string,
  event?: NativeWebViewEngineEvent
): string {
  const native = event?.nativeEvent as NativeWebViewEngineFields | undefined
  const parts = [context]
  const description = native?.description
  const statusCode = native?.statusCode
  const code = native?.code
  const domain = native?.domain
  if (typeof description === 'string') {
    parts.push(description)
  }
  if (typeof statusCode === 'number') {
    parts.push(`status ${statusCode}`)
  }
  if (typeof code === 'number') {
    parts.push(`code ${code}`)
  }
  if (typeof domain === 'string') {
    parts.push(domain)
  }
  if (native?.didCrash === true) {
    parts.push('renderer crashed')
  }
  return parts.join(' - ')
}

export function TerminalWebViewEngineErrorOverlay({
  message,
  terminalTheme,
  onReload
}: TerminalWebViewEngineErrorOverlayProps) {
  const background = terminalTheme?.theme.background ?? darkTheme.terminal.background
  const foreground = terminalTheme?.theme.foreground ?? darkTheme.terminal.foreground
  const secondary = terminalTheme?.theme.brightBlack ?? darkTheme.terminal.brightBlack
  const styles = useMemo(
    () => createTerminalWebViewEngineErrorStyles(background, foreground, secondary),
    [background, foreground, secondary]
  )

  return (
    <View style={styles.errorOverlay}>
      <Text style={styles.errorTitle}>Terminal failed to load</Text>
      <Text style={styles.errorDetail} numberOfLines={4}>
        {message}
      </Text>
      <Pressable accessibilityRole="button" style={styles.reloadButton} onPress={onReload}>
        <RefreshCw size={16} color={background} />
        <Text style={styles.reloadButtonText}>Reload</Text>
      </Pressable>
    </View>
  )
}

function createTerminalWebViewEngineErrorStyles(
  background: string,
  foreground: string,
  secondary: string
) {
  return StyleSheet.create({
    errorOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 24,
      backgroundColor: background
    },
    errorTitle: {
      color: foreground,
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'center'
    },
    errorDetail: {
      color: secondary,
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center'
    },
    reloadButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 8,
      backgroundColor: foreground
    },
    reloadButtonText: {
      color: background,
      fontSize: 14,
      fontWeight: '700'
    }
  })
}
