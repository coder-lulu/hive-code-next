import { formatAiPrice } from '../../../../shared/hive-ai-model-candidates'
import { Button } from '@/components/ui/button'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { useHiveAiRead } from './use-hive-ai-read'

const readModels = () => window.api.hiveAccount.readAiModelCandidates()
const copy = (key: string, fallback: string) => translate(`hiveAiModels.${key}`, fallback)

export function HiveAiModelsSection({ accountId }: { accountId: string }): React.JSX.Element {
  const { snapshot, loading, failed, refresh } = useHiveAiRead(accountId, readModels)
  const catalog = snapshot?.catalog
  const locale = getIntlLocale()
  return (
    <section
      aria-label={copy('title', 'AI models & prices')}
      aria-busy={loading}
      className="rounded-xl border border-border/60 bg-card p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{copy('title', 'AI models & prices')}</h3>
        <Button
          aria-label={copy('refreshPrices', 'Refresh AI model prices')}
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {copy('refresh', 'Refresh')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {copy(
          'description',
          'New API reference catalog and base rates. Model availability is checked separately for your account.'
        )}
      </p>
      <div aria-live="polite" className="text-xs text-muted-foreground space-y-3">
        {loading ? (
          copy('loading', 'Loading model prices…')
        ) : failed ? (
          copy('unavailable', 'Model prices are unavailable. Refresh later.')
        ) : catalog ? (
          <>
            <p>
              {copy(
                'units',
                'Reference group rates in AI points per million tokens. These are not currency amounts or final charges.'
              )}
            </p>
            {catalog.models.length === 0 && (
              <p>{copy('empty', 'No reference models are available.')}</p>
            )}
            <ul className="divide-y divide-border/60">
              {catalog.models.map((model) => (
                <li key={model.candidateId} className="py-3 space-y-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <h4 className="break-all text-sm font-medium text-foreground">
                      {model.displayName}
                    </h4>
                    <span>{copy('candidate', 'Reference')}</span>
                  </div>
                  <p>
                    {model.protocols
                      .map((p) => (p === 'RESPONSES' ? 'Responses' : 'Chat Completions'))
                      .join(' / ')}
                  </p>
                  {model.price.mode !== 'TOKEN_RATIO' && (
                    <p>
                      {model.price.mode === 'TIERED'
                        ? copy('tiered', 'Tiered billing. Price details are pending.')
                        : copy('noRates', 'No token rates are available.')}
                    </p>
                  )}
                  <dl className="space-y-2">
                    {[
                      [copy('input', 'Input'), model.price.input],
                      [copy('output', 'Output'), model.price.output],
                      [copy('cacheRead', 'Cache read'), model.price.cacheRead],
                      [copy('cacheWrite', 'Cache write'), model.price.cacheWrite]
                    ].map(([label, rate]) => (
                      <div key={label} className="flex flex-wrap justify-between gap-2">
                        <dt>{label}</dt>
                        <dd className="break-all text-foreground tabular-nums">
                          {formatAiPrice(rate ?? null, locale)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
            <p>
              {copy('updated', 'Updated')}{' '}
              {new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'medium',
                timeZone: 'Asia/Shanghai'
              }).format(new Date(catalog.asOf))}{' '}
              {translate('hiveAiAccount.timeZone', '· UTC+08:00')}
            </p>
          </>
        ) : null}
      </div>
    </section>
  )
}
