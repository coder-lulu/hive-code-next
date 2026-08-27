import { useMemo } from 'react'
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import type { MobileTheme } from '../theme/mobile-theme'

// Pure types and selectors live in account-usage-state.ts (no RN imports) so
// they are unit-testable; re-exported here so existing import sites are stable.
export type {
  RateLimitWindow,
  ProviderRateLimits,
  InactiveAccountUsage,
  ClaudeAccountSummary,
  CodexAccountSummary,
  AccountsSnapshot,
  ProviderKey,
  UsageBarState
} from './account-usage-state'
export {
  decodeAccountsSnapshot,
  getActiveProviderRateLimits,
  getInactiveProviderUsage,
  getUsageBarState,
  getWindowResetLabel,
  hasActiveProviderUsage,
  hasRenderableUsage
} from './account-usage-state'

// Why: matches desktop StatusBar — bars show percent used (consumption), same
// as Claude/Codex harness meters. Fresh account is empty/green; depleted is
// full/red.
export function UsageBar({
  label,
  usedPercent,
  unavailable,
  loading,
  resetText,
  theme
}: {
  label: string
  usedPercent: number | null
  unavailable: boolean
  loading?: boolean
  resetText?: string | null
  theme?: MobileTheme
}) {
  const styles = useMemo(() => createStyles(theme), [theme])
  // Why: round then clamp so bar width, color, and label share one value (desktop parity).
  const used = usedPercent == null ? null : Math.max(0, Math.min(100, Math.round(usedPercent)))
  // Why: same consumption bands as desktop barColor (green <60, amber <80, red ≥80).
  const barColor =
    used == null
      ? (theme?.color.text.tertiary ?? colors.textMuted)
      : used >= 80
        ? (theme?.color.status.danger ?? colors.statusRed)
        : used >= 60
          ? (theme?.color.status.warning ?? colors.statusAmber)
          : (theme?.color.status.success ?? colors.statusGreen)
  return (
    <View style={styles.usageBarColumn}>
      <View style={styles.usageBar}>
        <Text style={styles.usageLabel}>{label}</Text>
        <View style={styles.usageTrack}>
          <View
            style={[
              styles.usageFill,
              {
                width: `${used ?? 0}%`,
                backgroundColor: unavailable
                  ? (theme?.color.text.tertiary ?? colors.textMuted)
                  : barColor
              }
            ]}
          />
        </View>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={theme?.color.text.secondary ?? colors.textSecondary}
            style={styles.usageSpinner}
          />
        ) : (
          <Text style={styles.usageValue}>{unavailable || used == null ? '—' : `${used}%`}</Text>
        )}
      </View>
      {resetText ? (
        <Text style={styles.usageResetText} numberOfLines={1}>
          {resetText}
        </Text>
      ) : null}
    </View>
  )
}

function createStyles(theme?: MobileTheme) {
  const labelStyle = theme?.typography.caption ?? { fontSize: typography.metaSize }
  const gap = theme?.spacing.space4 ?? spacing.xs
  return StyleSheet.create({
    usageBarColumn: { flex: 1, gap },
    usageBar: { flexDirection: 'row', alignItems: 'center', gap },
    usageLabel: {
      ...labelStyle,
      width: 22,
      color: theme?.color.text.tertiary ?? colors.textMuted
    },
    usageTrack: {
      flex: 1,
      height: 6,
      overflow: 'hidden',
      borderRadius: theme?.radii.small ?? 4,
      backgroundColor: theme?.color.bg.subtle ?? colors.bgRaised
    },
    usageFill: { height: '100%', borderRadius: theme?.radii.small ?? 4 },
    usageValue: {
      ...labelStyle,
      width: 36,
      color: theme?.color.text.secondary ?? colors.textSecondary,
      textAlign: 'right'
    },
    usageSpinner: { width: 36 },
    // Why: indented past the window label so the countdown aligns with the track above it.
    usageResetText: {
      ...labelStyle,
      marginLeft: 22 + gap,
      color: theme?.color.text.tertiary ?? colors.textMuted
    }
  })
}
