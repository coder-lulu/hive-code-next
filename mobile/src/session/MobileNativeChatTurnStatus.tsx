import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import {
  describeNativeChatTurnStatus,
  nativeChatElapsedSeconds
} from '../../../src/shared/native-chat-turn-status'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { useReducedMotionEnabled } from '../hooks/use-reduced-motion-enabled'

/** Seconds tick only while a turn is actually counting, so a settled transcript
 *  holds no timers. */
function useElapsedSeconds(startedAt: number | null, counting: boolean): number {
  // Preserves the pre-stamp epoch for the frame before the turn's startedAt lands.
  const [mountedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!counting) {
      return
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [counting])
  return counting ? nativeChatElapsedSeconds(startedAt, mountedAt, now) : 0
}

/** The per-turn status row — "Thinking", then "Working for 12s" while the turn
 *  runs, settling to a tappable "Worked for 3m 4s" that discloses the turn's
 *  tool activity. Desktop parity: `NativeChatWorkingStatus`. */
export function MobileNativeChatTurnStatus({
  startedAt,
  thinking,
  workedSeconds,
  expanded = false,
  onToggleExpanded
}: {
  startedAt: number | null
  thinking: boolean
  workedSeconds?: number | null
  expanded?: boolean
  onToggleExpanded?: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const reducedMotion = useReducedMotionEnabled()
  const counting = !thinking && workedSeconds == null
  const elapsedSeconds = useElapsedSeconds(startedAt, counting)
  const status = describeNativeChatTurnStatus({ thinking, workedSeconds, elapsedSeconds })
  const label =
    status.key === 'thinking'
      ? '思考中'
      : `${status.key === 'workingFor' ? '正在处理' : '处理完成'} · ${status.duration}`

  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!thinking || reducedMotion) {
      pulse.setValue(1)
      return
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: theme.motion.standardDurationMs,
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: theme.motion.standardDurationMs,
          useNativeDriver: true
        })
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [pulse, thinking, reducedMotion, theme.motion.standardDurationMs])

  const rowStyle = [styles.row, thinking ? null : styles.rowSettled]

  if (workedSeconds != null && onToggleExpanded) {
    return (
      <Pressable
        style={({ pressed }) => [...rowStyle, pressed && styles.pressed]}
        onPress={onToggleExpanded}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="切换本轮详情"
      >
        <Text style={styles.label}>{label}</Text>
        <View style={expanded ? styles.caretOpen : undefined}>
          <ChevronRight size={16} color={theme.color.text.tertiary} strokeWidth={2} />
        </View>
      </Pressable>
    )
  }

  return (
    <View style={rowStyle} accessibilityLiveRegion="polite" accessibilityLabel="智能体正在回复">
      <Animated.Text style={[styles.label, thinking && { opacity: pulse }]}>{label}</Animated.Text>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space12
    },
    rowSettled: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    pressed: {
      opacity: 0.6
    },
    label: {
      ...theme.typography.body,
      color: theme.color.text.secondary
    },
    caretOpen: {
      transform: [{ rotate: '90deg' }]
    }
  })
}
