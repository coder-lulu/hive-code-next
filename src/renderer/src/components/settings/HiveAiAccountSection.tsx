import { formatAiInteger } from '../../../../shared/hive-ai-account'
import { Button } from '@/components/ui/button'
import { getIntlLocale, translate } from '@/i18n/i18n'

import { useHiveAiRead } from './use-hive-ai-read'
import { HiveAiBenefitsDetails } from './HiveAiBenefitsDetails'
import { HiveAiConsumptionSection } from './HiveAiConsumptionSection'

const readAccount = () => window.api.hiveAccount.readAiAccount()
const readBenefits = () => window.api.hiveAccount.readAiBenefits()
const activateAccount = () => window.api.hiveAccount.activateAiAccount()
const copy = (key: string, fallback: string) => translate(`hiveAiAccount.${key}`, fallback)

export function HiveAiAccountSection({ accountId }: { accountId: string }): React.JSX.Element {
  const {
    snapshot,
    loading,
    failed,
    refresh,
    activate,
    activating,
    activationFailed,
    showActivating
  } = useHiveAiRead(accountId, readAccount, activateAccount)
  const benefitsRead = useHiveAiRead(accountId, readBenefits)

  const current = snapshot?.accountId === accountId ? snapshot : null
  const balance = current?.balance
  const benefits = benefitsRead.snapshot?.benefits
  const statuses = [
    balance?.accountStatus,
    benefits?.accountStatus,
    current?.account.status,
    benefitsRead.snapshot?.account.status
  ]
  const status = statuses.find((value) => value && value !== 'ACTIVE') ?? statuses.find(Boolean)
  const account = current?.account ?? benefitsRead.snapshot?.account
  const canActivate =
    account?.activationAvailable && ['NOT_PROVISIONED', 'PENDING', 'UNKNOWN'].includes(status ?? '')
  const busy = loading || benefitsRead.loading || activating
  const locale = getIntlLocale()
  const messages = {
    NOT_PROVISIONED: canActivate
      ? copy('activationReady', 'Activate your AI account to create and link it.')
      : copy(
          'notProvisioned',
          'Your AI account is not activated. Activation is currently unavailable.'
        ),
    PENDING: copy('pending', 'Your AI account is being prepared. Refresh later.'),
    UNKNOWN: copy(
      'unknown',
      'Your AI account needs verification. Refresh later or contact support.'
    ),
    DISABLED: copy('disabled', 'Your AI account is disabled. Contact support.'),
    ACTIVE: ''
  }
  return (
    <section
      aria-label={copy('title', 'AI balance & usage')}
      aria-busy={busy}
      className="rounded-xl border border-border/60 bg-card p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{copy('title', 'AI balance & usage')}</h3>
        <div className="flex flex-wrap gap-2">
          {canActivate && (
            <Button
              size="sm"
              disabled={busy}
              aria-busy={activating}
              onClick={() => void activate(benefitsRead.refresh)}
            >
              {status === 'NOT_PROVISIONED'
                ? copy('activate', 'Activate AI account')
                : copy('verifyActivation', 'Verify activation')}
            </Button>
          )}
          <Button
            aria-label={copy('refreshBalance', 'Refresh AI balance')}
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void Promise.all([refresh(), benefitsRead.refresh()])}
          >
            {copy('refresh', 'Refresh')}
          </Button>
        </div>
      </div>
      {activationFailed && (
        <p role="alert" className="text-xs text-muted-foreground">
          {copy(
            'activationFailed',
            'The activation request result could not be confirmed. Refresh or contact support.'
          )}
        </p>
      )}
      <div aria-live="polite" className="text-xs text-muted-foreground">
        {showActivating ? (
          copy('activating', 'Processing AI activation…')
        ) : status && messages[status] ? (
          messages[status]
        ) : loading ? (
          copy('loading', 'Loading AI account…')
        ) : failed ? (
          copy('unavailable', 'AI balance is unavailable. Refresh later.')
        ) : balance?.freshness !== 'CURRENT' ? (
          copy('unavailable', 'AI balance is unavailable. Refresh later.')
        ) : (
          <>
            <dl className="divide-y divide-border/60">
              {[
                [copy('available', 'Available AI points'), balance.availableQuota],
                [copy('used', 'Lifetime points used'), balance.usedQuota],
                [copy('requests', 'Lifetime requests'), balance.requestCount]
              ].map(([label, value]) => (
                <div key={label} className="flex flex-wrap justify-between gap-2 py-2">
                  <dt>{label}</dt>
                  <dd className="break-all font-medium tabular-nums text-foreground">
                    {formatAiInteger(value, locale)}
                  </dd>
                </div>
              ))}
            </dl>
            {balance.availableQuota !== null && BigInt(balance.availableQuota) <= 0n && (
              <p>
                {copy(
                  'insufficient',
                  'Your wallet points are insufficient. Plan points are accounted for separately.'
                )}
              </p>
            )}
            <p className="mt-2">
              {copy('updated', 'Updated')}{' '}
              {balance.asOf &&
                new Intl.DateTimeFormat(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'medium',
                  timeZone: 'Asia/Shanghai'
                }).format(new Date(balance.asOf))}{' '}
              {copy('timeZone', '· UTC+08:00')}
            </p>
            <p className="mt-2">
              {copy(
                'units',
                '1 point = 1 New API quota unit. Points are not currency. Usage totals cover the lifetime of this AI account.'
              )}
            </p>
          </>
        )}
      </div>
      {status === 'ACTIVE' && (
        <HiveAiBenefitsDetails benefits={benefits} loading={benefitsRead.loading} locale={locale} />
      )}
      {status === 'ACTIVE' && <HiveAiConsumptionSection key={accountId} accountId={accountId} />}
    </section>
  )
}
