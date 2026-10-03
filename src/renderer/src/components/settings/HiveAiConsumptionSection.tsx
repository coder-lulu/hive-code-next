import { useCallback, useState } from 'react'
import {
  consumptionRange,
  consumptionPreset,
  type ConsumptionQuery
} from '../../../../shared/hive-ai-consumption'
import { formatAiInteger } from '../../../../shared/hive-ai-account'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { useHiveAiRead } from './use-hive-ai-read'

const copy = (key: string, fallback: string) => translate(`hiveAiConsumption.${key}`, fallback)
export function HiveAiConsumptionSection({ accountId }: { accountId: string }): React.JSX.Element {
  const [initialDates] = useState(() => consumptionPreset(7))
  const [from, setFrom] = useState(initialDates[0])
  const [to, setTo] = useState(initialDates[1])
  const [model, setModel] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [query, setQuery] = useState<ConsumptionQuery>(() => ({
    ...consumptionRange(initialDates),
    page: 1,
    size: 20
  }))
  const read = useCallback(() => window.api.hiveAccount.readAiConsumption(query), [query])
  const { snapshot, loading, failed } = useHiveAiRead(accountId, read)
  const result = snapshot?.history
  const current =
    !invalid &&
    result?.from === query.from &&
    result.to === query.to &&
    result.page === query.page &&
    result.model === query.model
      ? result
      : null
  const locale = getIntlLocale()
  function search(event: React.FormEvent) {
    event.preventDefault()
    submit([from, to])
  }
  function submit(dates: [string, string]) {
    try {
      const range = consumptionRange(dates, model.trim())
      setInvalid(false)
      setQuery({ ...range, page: 1, size: 20 })
    } catch {
      setInvalid(true)
    }
  }
  function preset(days: 1 | 7 | 30) {
    const dates = consumptionPreset(days)
    setFrom(dates[0])
    setTo(dates[1])
    submit(dates)
  }
  return (
    <section
      aria-label={copy('title', 'Consumption records')}
      aria-busy={loading}
      className="min-w-0 space-y-3 border-t border-border/60 pt-3"
    >
      <h4 className="text-sm font-semibold">{copy('title', 'Consumption records')}</h4>
      <p className="text-xs text-muted-foreground">
        {copy(
          'notice',
          'UTC+08:00, up to 31 days. Live gateway logs; recorded points are not confirmed settlement. New records may appear between pages.'
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={loading} onClick={() => preset(1)}>
          {copy('today', 'Today')}
        </Button>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => preset(7)}>
          {copy('last7', 'Last 7 days')}
        </Button>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => preset(30)}>
          {copy('last30', 'Last 30 days')}
        </Button>
      </div>
      <form onSubmit={search} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="ai-consumption-from">{copy('from', 'Start date')}</Label>
          <Input
            id="ai-consumption-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-invalid={invalid}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="ai-consumption-to">{copy('to', 'End date')}</Label>
          <Input
            id="ai-consumption-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-invalid={invalid}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="ai-consumption-model">{copy('modelFilter', 'Model (exact name)')}</Label>
          <Input
            id="ai-consumption-model"
            value={model}
            maxLength={128}
            onChange={(event) => setModel(event.target.value)}
            aria-invalid={invalid}
          />
        </div>
        <Button type="submit" size="sm" disabled={loading}>
          {copy('search', 'Search records')}
        </Button>
      </form>
      <div aria-live="polite" className="text-xs text-muted-foreground">
        {invalid ? (
          <p role="alert">{copy('invalid', 'Select up to 31 days and check the model name.')}</p>
        ) : failed ? (
          <p role="alert">
            {copy('unavailable', 'Consumption records are unavailable. Try again later.')}
          </p>
        ) : loading ? (
          <p>{copy('loading', 'Loading consumption records…')}</p>
        ) : (
          current && (
            <>
              {current.entries.length === 0 ? (
                <p>{copy('empty', 'No records in this range.')}</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {current.entries.map((row, index) => (
                    <li key={`${row.gatewayRequestId}-${index}`} className="space-y-1 py-3">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="break-all font-medium text-foreground">{row.modelId}</span>
                        <span>
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: 'short',
                            timeStyle: 'short',
                            timeZone: 'Asia/Shanghai'
                          }).format(new Date(row.recordedAt))}
                        </span>
                      </div>
                      <dl className="space-y-1">
                        {[
                          [copy('points', 'Recorded points'), row.recordedPoints],
                          [copy('input', 'Input tokens'), row.inputTokens],
                          [copy('output', 'Output tokens'), row.outputTokens]
                        ].map(([label, value]) => (
                          <div key={label} className="flex flex-wrap justify-between gap-2">
                            <dt>{label}</dt>
                            <dd className="break-all tabular-nums text-foreground">
                              {formatAiInteger(value, locale)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <p className="break-all">
                        {copy('request', 'Gateway request ID')}: {row.gatewayRequestId}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={current.page <= 1}
                  onClick={() => setQuery({ ...query, page: query.page - 1 })}
                >
                  {copy('previous', 'Previous')}
                </Button>
                <span>
                  {copy('page', 'Page')} {current.page}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    current.page >= 1000 ||
                    BigInt(current.reportedTotal) <= BigInt(current.page * current.size)
                  }
                  onClick={() => setQuery({ ...query, page: query.page + 1 })}
                >
                  {copy('next', 'Next')}
                </Button>
              </div>
            </>
          )
        )}
      </div>
    </section>
  )
}
