import { useEffect, useState } from 'react'
import { Bot, Clock, GitPullRequest } from 'lucide-react'
import { useAppStore } from '../../store'
import { StatCard } from './StatCard'
import { ClaudeUsagePane } from './ClaudeUsagePane'
import { CodexUsagePane } from './CodexUsagePane'
import { GrokUsagePane } from './GrokUsagePane'
import { OpenCodeUsagePane } from './OpenCodeUsagePane'
import { MuseUsagePane } from './MuseUsagePane'
import { UsageOverviewPane } from './UsageOverviewPane'
import { getIntlLocale, translate } from '@/i18n/i18n'
export { getStatsPaneSearchEntries } from './stats-search'

function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '0m'
  }

  const totalMinutes = Math.floor(ms / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalDays = Math.floor(totalHours / 24)
  const remainingHours = totalHours % 24
  const remainingMinutes = totalMinutes % 60

  if (totalDays > 0) {
    return `${totalDays}d ${remainingHours}h`
  }
  if (totalHours > 0) {
    return `${totalHours}h ${remainingMinutes}m`
  }
  return `${totalMinutes}m`
}

function formatTrackingSince(timestamp: number | null): string {
  if (!timestamp) {
    return ''
  }
  const date = new Date(timestamp)
  return translate('auto.components.stats.StatsPane.trackingSince', 'Tracking since {{value0}}', {
    value0: date.toLocaleDateString(getIntlLocale(), {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  })
}

export function StatsPane({ isActive = true }: { isActive?: boolean }): React.JSX.Element {
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [subscriptionOpen, setSubscriptionOpen] = useState(false)
  const summary = useAppStore((s) => s.statsSummary)
  const fetchStatsSummary = useAppStore((s) => s.fetchStatsSummary)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  useEffect(() => {
    if (!isActive) {
      return
    }
    void recordFeatureInteraction('usage-tracking')
    void fetchStatsSummary()
  }, [isActive, fetchStatsSummary, recordFeatureInteraction])
  return (
    <div className="space-y-6">
      <UsageOverviewPane isActive={isActive} />
      <details
        className="rounded-lg border border-border p-4"
        onToggle={(event) => setCollectionOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-semibold">
          {translate('usage.redesign.collection', 'Collection settings and source details')}
        </summary>
        {collectionOpen && isActive && (
          <div className="mt-4 space-y-4">
            <ClaudeUsagePane />
            <CodexUsagePane />
            <OpenCodeUsagePane />
            <MuseUsagePane />
          </div>
        )}
      </details>
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          {translate('usage.redesign.outcomes', 'Work outcomes · lifetime')}
        </summary>
        {summary && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard
                label={translate('auto.components.stats.StatsPane.9dbec9e675', 'Agents spawned')}
                value={summary.totalAgentsSpawned.toLocaleString(getIntlLocale())}
                icon={<Bot className="size-4" />}
              />
              <StatCard
                label={translate('usage.redesign.agentTime', 'Cumulative agent runtime')}
                value={formatDuration(summary.totalAgentTimeMs)}
                icon={<Clock className="size-4" />}
              />
              <StatCard
                label={translate('auto.components.stats.StatsPane.a58aba506f', 'PRs created')}
                value={summary.totalPRsCreated.toLocaleString(getIntlLocale())}
                icon={<GitPullRequest className="size-4" />}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {formatTrackingSince(summary.firstEventAt)}
            </p>
          </div>
        )}
      </details>
      <details
        className="rounded-lg border border-border p-4"
        onToggle={(event) => setSubscriptionOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-semibold">
          {translate('usage.redesign.subscriptions', 'Subscription limits')}
        </summary>
        {subscriptionOpen && isActive && (
          <div className="mt-4">
            <GrokUsagePane />
          </div>
        )}
      </details>
    </div>
  )
}
