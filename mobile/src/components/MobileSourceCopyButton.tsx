import { useLayoutEffect, useRef, useState } from 'react'
import { Alert, Platform, Pressable, StyleSheet, Text } from 'react-native'
import { Check, Copy } from 'lucide-react-native'
import { useClipboardWriter } from '../platform/clipboard'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

type CopyFeedback = { status: 'copied'; text: string } | { status: 'failed' }

export function MobileSourceCopyButton({
  text,
  accessibilityLabel,
  partial = false
}: {
  text: string
  accessibilityLabel: string
  partial?: boolean
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const clipboard = useClipboardWriter()
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null)
  const latestAttempt = useRef<{ sourceVersion: number } | null>(null)
  const sourceVersion = useRef(0)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (feedback?.status === 'copied' && feedback.text !== text) {
    setFeedback(null)
  }
  useLayoutEffect(
    () => () => {
      latestAttempt.current = null
      if (resetTimer.current !== null) {
        clearTimeout(resetTimer.current)
        resetTimer.current = null
      }
    },
    []
  )
  // Streaming invalidates success feedback, while the pending user action still owns failures.
  useLayoutEffect(() => {
    sourceVersion.current++
    if (feedback?.status !== 'failed' && resetTimer.current !== null) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
  }, [text])

  const showFeedback = (result: CopyFeedback, attempt: { sourceVersion: number }) => {
    setFeedback(result)
    resetTimer.current = setTimeout(() => {
      resetTimer.current = null
      if (latestAttempt.current === attempt) {
        setFeedback(null)
      }
    }, 1500)
  }

  const copy = async () => {
    if (text.length === 0) {
      return
    }
    const attempt = { sourceVersion: sourceVersion.current }
    latestAttempt.current = attempt
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
    setFeedback(null)
    try {
      await clipboard.writeText(text)
    } catch (error) {
      if (latestAttempt.current !== attempt) {
        return
      }
      if (Platform.OS === 'web') {
        showFeedback({ status: 'failed' }, attempt)
      } else {
        Alert.alert(
          'Copy failed',
          error instanceof Error ? error.message : 'The clipboard rejected the text.'
        )
      }
      return
    }
    if (latestAttempt.current !== attempt || sourceVersion.current !== attempt.sourceVersion) {
      return
    }
    showFeedback({ status: 'copied', text }, attempt)
  }
  const copied = feedback?.status === 'copied' && feedback.text === text
  const failed = feedback?.status === 'failed'
  const label = failed
    ? 'Failed'
    : copied
      ? partial
        ? 'Copied loaded'
        : 'Copied'
      : partial
        ? 'Copy loaded'
        : 'Copy'
  const Icon = copied ? Check : Copy
  const iconColor = failed
    ? theme.color.status.dangerText
    : copied
      ? theme.color.status.success
      : theme.color.text.tertiary
  return (
    <Pressable
      style={({ pressed }) => [styles.button, partial && styles.partial, pressed && styles.pressed]}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={failed ? "Couldn't copy" : accessibilityLabel}
      accessibilityLiveRegion={failed ? 'polite' : undefined}
      accessibilityValue={{ text: failed ? "Couldn't copy" : copied ? label : undefined }}
      aria-valuetext={failed ? "Couldn't copy" : copied ? label : undefined}
      accessibilityState={{ disabled: text.length === 0 }}
      disabled={text.length === 0}
      onPress={() => void copy()}
    >
      <Icon size={theme.size.iconSmall} color={iconColor} />
      {partial ? <Text style={styles.label}>{label}</Text> : null}
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    button: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space4,
      borderRadius: theme.radii.control
    },
    partial: { paddingHorizontal: theme.spacing.space8 },
    pressed: { backgroundColor: theme.color.bg.subtle },
    label: { color: theme.color.text.tertiary, ...theme.typography.meta }
  })
}
