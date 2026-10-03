import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type { UsageOverviewDailyPoint } from './usage-overview-types'
import { formatUsageTokens } from './usage-overview-model'

export function UsageOverviewTrend({
  daily,
  selectedDay,
  onSelectDay,
  cumulative,
  onCumulativeChange
}: {
  daily: UsageOverviewDailyPoint[]
  selectedDay: string | null
  onSelectDay: (day: string | null) => void
  cumulative: boolean
  onCumulativeChange: (value: boolean) => void
}): React.JSX.Element {
  let total = 0
  const points = daily
    .map((day) => ({
      ...day,
      value: cumulative ? (total += day.totalTokens) : day.totalTokens
    }))
    .slice(-90)
  const maximum = points.reduce((max, day) => Math.max(max, day.value), 1)
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">
          {translate('usage.redesign.trend', 'Daily token usage')}
        </h4>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={!cumulative ? 'secondary' : 'ghost'}
            aria-pressed={!cumulative}
            onClick={() => onCumulativeChange(false)}
          >
            {translate('usage.redesign.period', 'Per day')}
          </Button>
          <Button
            size="sm"
            variant={cumulative ? 'secondary' : 'ghost'}
            aria-pressed={cumulative}
            onClick={() => onCumulativeChange(true)}
          >
            {translate('usage.redesign.cumulative', 'Cumulative')}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {translate(
          'usage.redesign.dailyOnly',
          'Available history contains daily totals. Hourly usage, request counts and daily costs are not recorded; missing days are not confirmed zero usage.'
        )}
      </p>
      {daily.length > 90 && (
        <p className="text-xs text-muted-foreground">
          {translate(
            'usage.redesign.latestDays',
            'Showing the latest 90 recorded days. Cumulative totals include the entire selected range.'
          )}
        </p>
      )}
      <div className="overflow-x-auto">
        <div className="flex h-64 min-w-full items-end gap-2">
          {points.map((day) => (
            <Tooltip key={day.day}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={selectedDay === day.day}
                  aria-label={`${day.day}: ${formatUsageTokens(day.value)} ${translate('usage.redesign.tokenUnit', 'tokens')}`}
                  onClick={() => onSelectDay(selectedDay === day.day ? null : day.day)}
                  className="group flex h-full min-w-8 flex-1 flex-col justify-end gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex min-h-0 flex-1 items-end justify-center">
                    <span
                      className={`w-full rounded-t-sm ${selectedDay === day.day ? 'bg-primary' : 'bg-muted-foreground/60 group-hover:bg-foreground/75'}`}
                      style={{ height: `${Math.max((day.value / maximum) * 100, 1)}%` }}
                    />
                  </span>
                  <span className="text-xs text-muted-foreground">{day.day.slice(5)}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {day.day} · {formatUsageTokens(day.value)}{' '}
                {translate('usage.redesign.tokenUnit', 'tokens')}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
      {selectedDay && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            {selectedDay} ·{' '}
            {formatUsageTokens(daily.find((day) => day.day === selectedDay)?.totalTokens ?? 0)}{' '}
            {translate('usage.redesign.tokenUnit', 'tokens')}
          </span>
          <Button size="xs" variant="ghost" onClick={() => onSelectDay(null)}>
            {translate('usage.redesign.clearDay', 'Clear selected day')}
          </Button>
        </div>
      )}
    </section>
  )
}
