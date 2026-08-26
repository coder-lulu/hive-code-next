import { View, StyleSheet } from 'react-native'
import { colors } from '../theme/mobile-theme'
import type { MobileTheme } from '../theme/mobile-theme'
import type { ConnectionState } from '../transport/types'
import type { ConnectionVerdict } from '../transport/connection-health'

const stateColors: Record<ConnectionState, string> = {
  connected: colors.statusGreen,
  connecting: colors.statusAmber,
  handshaking: colors.statusAmber,
  reconnecting: colors.statusAmber,
  disconnected: colors.textMuted,
  'auth-failed': colors.statusRed
}

// Why: when caller passes a verdict, the dot color reflects the verdict's
// severity instead of the raw transport state. This avoids the "amber dot
// next to red 'Can't reach desktop' label" mismatch — the underlying
// transport is still 'reconnecting' (amber) but the user-visible meaning
// has escalated to error (red).
export function StatusDot({
  state,
  verdict,
  theme
}: {
  state: ConnectionState
  verdict?: ConnectionVerdict
  theme?: MobileTheme
}) {
  const semanticStateColor = theme
    ? {
        connected: theme.color.status.success,
        connecting: theme.color.status.warning,
        handshaking: theme.color.status.warning,
        reconnecting: theme.color.status.warning,
        disconnected: theme.color.text.tertiary,
        'auth-failed': theme.color.status.danger
      }[state]
    : null
  const color =
    verdict?.kind === 'unreachable' || verdict?.kind === 'auth-failed'
      ? (theme?.color.status.danger ?? colors.statusRed)
      : verdict?.kind === 'warning'
        ? (theme?.color.status.warning ?? colors.statusAmber)
        : (semanticStateColor ?? stateColors[state] ?? colors.textMuted)
  return <View style={[styles.dot, { backgroundColor: color }]} />
}

const styles = StyleSheet.create({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8
  }
})
