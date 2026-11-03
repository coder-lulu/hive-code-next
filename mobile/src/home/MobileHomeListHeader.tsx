import { useMobileTranslation } from '../i18n/use-mobile-translation'
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
  const t = useMobileTranslation()

  const theme = useMobileTheme()
  const styles = createStyles(theme)
  return (
    <View style={styles.container}>
      {stats ? (
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text maxFontSizeMultiplier={1.3} style={styles.statValue}>
              {stats.totalAgentsSpawned.toLocaleString()}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.statLabel}>
              {t('auto.mobile.src.home.MobileHomeListHeader.83d3c8e05a', 'Agents started')}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text maxFontSizeMultiplier={1.3} style={styles.statValue}>
              {formatDuration(stats.totalAgentTimeMs)}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.statLabel}>
              {t('auto.mobile.src.home.MobileHomeListHeader.9d7871f9b9', 'Agent time')}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text maxFontSizeMultiplier={1.3} style={styles.statValue}>
              {stats.totalPRsCreated.toLocaleString()}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.statLabel}>
              {t('home.listHeader.prsCreated', 'PRs created')}
            </Text>
          </View>
        </View>
      ) : null}
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.sectionHeading}>
        {t('auto.mobile.src.home.MobileHomeListHeader.4b68984038', 'Computer')}
      </Text>
    </View>
  )
}

function createStyles(theme: ReturnType<typeof useMobileTheme>) {
  return StyleSheet.create({
    container: {
      paddingTop: theme.spacing.space16
    },
    statsRow: {
      flexDirection: 'row',
      gap: theme.spacing.space8,
      marginBottom: theme.spacing.space24
    },
    statCard: {
      flex: 1,
      minHeight: theme.spacing.space64,
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
      marginTop: theme.spacing.space4,
      marginBottom: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space4,
      color: theme.color.text.secondary,
      fontWeight: '600'
    }
  })
}
