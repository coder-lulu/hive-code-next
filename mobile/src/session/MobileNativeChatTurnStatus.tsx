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
import type { AgentTurnOutcome } from '../../../src/shared/agent-turn-outcome'

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

/** The turn bar under the user's message: "Working for 12s" while the turn runs,
 *  settling in place to a tappable "Worked for 3m 4s" ("Interrupted after" for a Stop,
 *  "Failed after" for a fault) that discloses the turn's tool activity. Desktop parity:
 *  `NativeChatWorkingStatus`. */
export function MobileNativeChatTurnStatus({
  startedAt,
  workedSeconds,
  verdict,
  expanded = false,
  onToggleExpanded
}: {
  startedAt: number | null
  workedSeconds?: number | null
  /** How a settled turn ended; it picks the settled label. */
  verdict?: AgentTurnOutcome
  expanded?: boolean
  onToggleExpanded?: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const settled = workedSeconds != null
  const elapsedSeconds = useElapsedSeconds(startedAt, !settled)
  const status = describeNativeChatTurnStatus({ workedSeconds, elapsedSeconds, verdict })
  const captions = {
    workingFor: '正在处理',
    workedFor: '处理完成',
    interruptedAfter: '已中断',
    failedAfter: '处理失败'
  }
  const label = `${captions[status.key]} · ${status.duration}`

  if (settled && onToggleExpanded) {
    return (
      <Pressable
        style={({ pressed }) => [styles.row, styles.bar, pressed && styles.pressed]}
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
    <View style={[styles.row, styles.bar]}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

/** The live turn's tail line: a spinner beside what the provider says it is doing,
 *  else "Thinking", else "Working…". The clock stays in the turn bar. Desktop
 *  parity: `NativeChatTurnActivityLine`. */
export function MobileNativeChatTurnActivity({
  thinking,
  activityText
}: {
  thinking: boolean
  activityText?: string | null
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const reducedMotion = useReducedMotionEnabled()
  const label = activityText?.trim() || (thinking ? '思考中' : '正在处理…')
  return (
    <View style={styles.row} accessibilityLiveRegion="polite" accessibilityLabel="智能体正在回复">
      {reducedMotion ? (
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
    bar: {
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
