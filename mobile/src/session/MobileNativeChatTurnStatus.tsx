import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronRight, Circle } from 'lucide-react-native'
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

/** The per-turn status row. While the turn runs it is the one live indicator — a
 *  spinner beside what the provider says it is doing, else "Thinking", else
 *  "Working for 12s". It settles to a tappable "Worked for 3m 4s" that discloses
 *  the turn's tool activity. Desktop parity: `NativeChatTurnActivityLine` for the
 *  live row, `NativeChatWorkingStatus` for the settled one. */
export function MobileNativeChatTurnStatus({
  startedAt,
  thinking,
  workedSeconds,
  activityText,
  expanded = false,
  onToggleExpanded
}: {
  startedAt: number | null
  thinking: boolean
  workedSeconds?: number | null
  /** Provider activity copy for a live turn; outranks the other two labels. */
  activityText?: string | null
  expanded?: boolean
  onToggleExpanded?: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const reducedMotion = useReducedMotionEnabled()
  const settled = workedSeconds != null
  const counting = !settled && !thinking && !activityText?.trim()
  const elapsedSeconds = useElapsedSeconds(startedAt, counting)
  const status = describeNativeChatTurnStatus({ thinking, workedSeconds, elapsedSeconds })
  const label =
    !settled && activityText?.trim()
      ? activityText.trim()
      : status.key === 'thinking'
        ? '思考中'
        : `${status.key === 'workingFor' ? '正在处理' : '处理完成'} · ${status.duration}`

  if (settled && onToggleExpanded) {
    return (
      <Pressable
        style={({ pressed }) => [styles.row, styles.rowSettled, pressed && styles.pressed]}
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
    <View
      style={[styles.row, settled ? styles.rowSettled : null]}
      accessibilityLiveRegion="polite"
      accessibilityLabel="智能体正在回复"
    >
      {settled ? null : reducedMotion ? (
        <Circle size={16} color={theme.color.text.tertiary} strokeWidth={2} />
      ) : (
        <ActivityIndicator size="small" color={theme.color.text.tertiary} />
      )}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
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
      color: theme.color.text.secondary,
      flexShrink: 1
    },
    caretOpen: {
      transform: [{ rotate: '90deg' }]
    }
  })
}
