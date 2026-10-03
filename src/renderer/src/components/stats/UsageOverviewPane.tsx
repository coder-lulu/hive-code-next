import { useEffect, useMemo, useState } from 'react'
import type { MuseUsageSnapshot } from '../../../../shared/muse-usage-types'
import { useAppStore } from '../../store'
import { RefreshCw } from 'lucide-react'
import type { ClaudeUsageRange } from '../../../../shared/claude-usage-types'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { buildUsageOverview, formatUsageCost, formatUsageTokens } from './usage-overview-model'
import { DailyIntensityGrid, TokenMixBar } from './usage-overview-sections'
import { getRecentUsageDays } from './usage-overview-daily-series'
import type { UsageProviderId } from './usage-overview-types'
import { useUsageOverviewQuery } from './use-usage-overview-query'
import { UsageOverviewTrend } from './UsageOverviewTrend'

export function UsageOverviewPane({ isActive = true }: { isActive?: boolean }): React.JSX.Element {
  const [range, setRange] = useState<ClaudeUsageRange>('30d')
  const [agent, setAgent] = useState<UsageProviderId | 'all'>('all')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [cumulative, setCumulative] = useState(false)
  const { data, loading, error, refresh } = useUsageOverviewQuery(range, isActive)
  const fetchMuseUsage = useAppStore((state) => state.fetchMuseUsage)
  const refreshMuseUsage = useAppStore((state) => state.refreshMuseUsage)
  const museScanCompletedAt = useAppStore(
    (state) => state.museUsageScanState?.lastScanCompletedAt ?? null
  )
  const [museSnapshot, setMuseSnapshot] = useState<MuseUsageSnapshot | null>(null)
  const [museLoading, setMuseLoading] = useState(false)
  const [museUnavailable, setMuseUnavailable] = useState(false)

  useEffect(() => {
    if (isActive) {
      void fetchMuseUsage()
    }
  }, [fetchMuseUsage, isActive])

  useEffect(() => {
    if (!isActive) {
      return
    }
    let current = true
    setMuseSnapshot(null)
    setMuseLoading(true)
    void window.api.museUsage
      .getSnapshot({ scope: 'all', range, limit: 100 })
      .then((snapshot) => {
        if (current) {
          setMuseSnapshot(snapshot)
          setMuseUnavailable(snapshot === null)
        }
      })
      .catch(() => {
        if (current) {
          setMuseSnapshot(null)
          setMuseUnavailable(true)
        }
      })
      .finally(() => {
        if (current) {
          setMuseLoading(false)
        }
      })
    return () => {
      current = false
    }
  }, [isActive, range, museScanCompletedAt])
  const overview = useMemo(
    () =>
      data
        ? buildUsageOverview({
            claude:
              agent === 'all' || agent === 'claude'
                ? data.claude
                : { scanState: null, summary: null, daily: [] },
            codex:
              agent === 'all' || agent === 'codex'
                ? data.codex
                : { scanState: null, summary: null, daily: [] },
            opencode:
              agent === 'all' || agent === 'opencode'
                ? data.opencode
                : { scanState: null, summary: null, daily: [] },
            muse:
              agent === 'all' || agent === 'muse'
                ? {
                    scanState: museSnapshot?.scanState ?? null,
                    summary: museSnapshot?.summary ?? null,
                    daily: museSnapshot?.daily ?? []
                  }
                : { scanState: null, summary: null, daily: [] }
          })
        : null,
    [data, agent, museSnapshot]
  )
  const recentDays = useMemo(
    () =>
      getRecentUsageDays(overview?.daily ?? [], range === 'all' ? 42 : Number.parseInt(range, 10)),
    [overview, range]
  )
  const bestDay = recentDays.reduce<(typeof recentDays)[number] | null>(
    (best, day) => (!best || day.totalTokens > best.totalTokens ? day : best),
    null
  )
  const providers =
    overview?.providers.filter((provider) => agent === 'all' || agent === provider.id) ?? []
  const selected = overview?.daily.find((day) => day.day === selectedDay)
  return (
    <div className="space-y-4" data-testid="usage-overview-pane" aria-busy={loading || museLoading}>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={range}
          onValueChange={(value) => {
            setRange(value as ClaudeUsageRange)
            setSelectedDay(null)
          }}
        >
          <SelectTrigger
            className="w-40"
            aria-label={translate('usage.redesign.rangeLabel', 'Time range')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['7d', '30d', '90d', 'all'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {translate(
                  `usage.redesign.range.${value}`,
                  value === 'all' ? 'All time' : `Last ${value.slice(0, -1)} days`
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={agent}
          onValueChange={(value) => {
            setAgent(value as UsageProviderId | 'all')
            setSelectedDay(null)
          }}
        >
          <SelectTrigger className="w-44" aria-label={translate('usage.redesign.agent', 'Agent')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {translate('usage.redesign.allAgents', 'All collected agents')}
            </SelectItem>
            <SelectItem value="claude">Claude</SelectItem>
            <SelectItem value="codex">Codex</SelectItem>
            <SelectItem value="opencode">OpenCode</SelectItem>
            <SelectItem value="muse">Muse</SelectItem>
          </SelectContent>
        </Select>
        <Button
          className="ml-auto"
          variant="outline"
          size="sm"
          onClick={() => {
            refresh()
            void refreshMuseUsage()
          }}
          disabled={loading || museLoading}
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          {translate('auto.components.stats.UsageOverviewPane.ca6bc5fded', 'Refresh')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {translate('usage.redesign.localScope', 'All local logs · daily totals in system timezone')}{' '}
        · {Intl.DateTimeFormat().resolvedOptions().timeZone}
        {overview?.lastUpdatedAt
          ? ` · ${new Date(overview.lastUpdatedAt).toLocaleString(getIntlLocale())}`
          : ''}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {translate(
            'usage.redesign.loadError',
            'Usage data could not be loaded. Refresh to retry.'
          )}
        </p>
      )}
      {museUnavailable && (
        <p role="status" className="text-sm text-muted-foreground">
          {translate('usage.redesign.museUnavailable', 'Muse usage is unavailable on this host.')}
        </p>
      )}
      {loading ? (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          {translate('usage.redesign.loading', 'Loading usage…')}
        </p>
      ) : (
        overview && (
          <>
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 xl:grid-cols-4">
              {[
                [
                  translate('auto.components.stats.UsageOverviewPane.3887b94ce5', 'Total tokens'),
                  formatUsageTokens(overview.totalTokens)
                ],
                [
                  translate('usage.redesign.estimatedUsd', 'Estimated cost · USD'),
                  formatUsageCost(overview.estimatedCostUsd)
                ],
                [
                  translate('usage.redesign.sessions', 'Sessions'),
                  overview.sessions.toLocaleString(getIntlLocale())
                ],
                [
                  translate('auto.components.stats.UsageOverviewPane.327603fe8b', 'Active days'),
                  overview.activeDays.toLocaleString(getIntlLocale())
                ]
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-2 break-words text-2xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'usage.redesign.costNotice',
                'Local estimates are not billed charges or New API points. Unpriced usage is unavailable, not free.'
              )}
              {overview.hasPartialCost
                ? ` ${translate('usage.redesign.partialCost', 'Some usage has no price.')}`
                : ''}
            </p>
            {!overview.hasAnyData && (
              <p className="text-sm text-muted-foreground">
                {translate(
                  'usage.redesign.empty',
                  'No usage in this range. Check collection settings below.'
                )}
              </p>
            )}
            <UsageOverviewTrend
              daily={overview.daily}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              cumulative={cumulative}
              onCumulativeChange={setCumulative}
            />
            <div className="grid gap-4 xl:grid-cols-2">
              <DailyIntensityGrid
                days={recentDays}
                bestDay={bestDay}
                onSelectDay={setSelectedDay}
                description={providers.map((provider) => provider.label).join(' · ')}
                recordedDays={new Set(overview.daily.map((day) => day.day))}
              />
              <TokenMixBar overview={overview} />
            </div>
            <section className="space-y-3">
              <h4 className="text-sm font-semibold">
                {translate('usage.redesign.agentDetails', 'Usage by agent')}
                {selected ? ` · ${selected.day}` : ''}
              </h4>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="p-3 text-left">
                        {translate('usage.redesign.agent', 'Agent')}
                      </th>
                      <th className="p-3 text-right">
                        {translate('usage.redesign.tokensLabel', 'Tokens')}
                      </th>
                      <th className="p-3 text-right">
                        {translate('usage.redesign.sessions', 'Sessions')}
                      </th>
                      <th className="p-3 text-right">
                        {translate('usage.redesign.estimatedUsd', 'Estimated cost · USD')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((provider) => (
                      <tr key={provider.id} className="border-t border-border">
                        <td className="p-3">
                          <span>{provider.label}</span>
                          {provider.isScanning && (
                            <p role="status" className="text-xs text-muted-foreground">
                              {translate('usage.redesign.loading', 'Loading usage…')}
                            </p>
                          )}
                          {provider.lastScanError && (
                            <p className="text-xs text-destructive">{provider.lastScanError}</p>
                          )}
                          {!provider.enabled && (
                            <p className="text-xs text-muted-foreground">
                              {translate('usage.redesign.collectionOff', 'Collection off')}
                            </p>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {formatUsageTokens(
                            selected
                              ? selected[
                                  provider.id === 'claude'
                                    ? 'claudeTokens'
                                    : provider.id === 'codex'
                                      ? 'codexTokens'
                                      : provider.id === 'opencode'
                                        ? 'openCodeTokens'
                                        : 'museTokens'
                                ]
                              : provider.totalTokens
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {selected ? '—' : provider.sessions.toLocaleString(getIntlLocale())}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {selected ? '—' : formatUsageCost(provider.estimatedCostUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )
      )}
    </div>
  )
}
