import { StyleSheet, Text, View } from 'react-native'
import type { HomeStatsSummary } from '../stats/home-stats-total'
import { useMobileTheme } from '../theme/mobile-theme-provider'

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  const minutes = totalMinutes % 60
  return totalHours > 0 ? `${totalHours}h ${minutes}m` : `${totalMinutes}m`
}

export function MobileHomeListHeader({ stats }: { stats: HomeStatsSummary | null }) {
  const theme = useMobileTheme()
  const styles = createStyles(theme)
  return (
    <View>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>连接电脑</Text>
      </View>
      {stats ? (
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalAgentsSpawned.toLocaleString()}</Text>
            <Text style={styles.statLabel}>已启动 Agent</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{formatDuration(stats.totalAgentTimeMs)}</Text>
            <Text style={styles.statLabel}>Agent 用时</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalPRsCreated.toLocaleString()}</Text>
            <Text style={styles.statLabel}>已创建 PR</Text>
          </View>
        </View>
      ) : null}
      <Text style={styles.sectionHeading}>已连接电脑</Text>
    </View>
  )
}

function createStyles(theme: ReturnType<typeof useMobileTheme>) {
  return StyleSheet.create({
    hero: { paddingTop: theme.spacing.space4, paddingBottom: theme.spacing.space16 },
    heroTitle: {
      ...theme.typography.pageTitle,
      color: theme.color.text.primary
    },
    statsRow: {
      flexDirection: 'row',
      gap: theme.spacing.space8,
      marginBottom: theme.spacing.space24
    },
    statCard: {
      flex: 1,
      minHeight: 72,
      justifyContent: 'center',
      gap: theme.spacing.space4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      paddingVertical: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      backgroundColor: theme.color.bg.surface
    },
    statValue: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary
    },
    statLabel: { ...theme.typography.caption, color: theme.color.text.tertiary },
    sectionHeading: {
      ...theme.typography.meta,
      marginBottom: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space4,
      color: theme.color.text.secondary,
      fontWeight: '600'
    }
  })
}
