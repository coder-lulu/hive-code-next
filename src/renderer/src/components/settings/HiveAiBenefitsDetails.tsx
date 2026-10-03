import type { AiBenefits } from '../../../../shared/hive-ai-account'
import { formatAiInteger } from '../../../../shared/hive-ai-account'
import { translate } from '@/i18n/i18n'

const copy = (key: string, fallback: string) => translate(`hiveAiAccount.${key}`, fallback)
export function HiveAiBenefitsDetails({
  benefits,
  loading,
  locale
}: {
  benefits: AiBenefits | null | undefined
  loading: boolean
  locale: string
}): React.JSX.Element {
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Shanghai'
        }).format(new Date(value))
      : '—'
  return (
    <div
      className="border-t border-border/60 pt-3 space-y-2 text-xs text-muted-foreground"
      aria-live="polite"
      aria-busy={loading}
    >
      <h4 className="font-semibold text-foreground">{copy('groupAndPlans', 'Group & plans')}</h4>
      {loading ? (
        <p>{copy('loadingBenefits', 'Loading group and plans…')}</p>
      ) : (
        <>
          <dl className="divide-y divide-border/60">
            <div className="flex flex-wrap justify-between gap-2 py-2">
              <dt>{copy('group', 'User group')}</dt>
              <dd className="break-all text-foreground">
                {benefits?.groupFreshness === 'CURRENT'
                  ? benefits.group
                  : copy('dataUnavailable', 'Unavailable')}
              </dd>
            </div>
          </dl>
          {benefits?.subscriptionsFreshness !== 'CURRENT' ? (
            <p>{copy('plansUnavailable', 'Plan information is unavailable. Refresh later.')}</p>
          ) : !benefits.subscriptions?.length ? (
            <p>{copy('noPlans', 'No plans')}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {benefits.subscriptions.map((plan) => (
                <li key={plan.id} className="py-3 space-y-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="break-all font-medium text-foreground">
                      {plan.title || `#${plan.planId}`}
                    </span>
                    <span>{copy(`planStatus_${plan.status}`, plan.status)}</span>
                  </div>
                  <dl className="space-y-1">
                    {[
                      [
                        copy('planTotal', 'Total points'),
                        plan.unlimited
                          ? copy('unlimited', 'Unlimited')
                          : formatAiInteger(plan.totalPoints, locale)
                      ],
                      [
                        copy('planRemaining', 'Remaining points'),
                        plan.unlimited
                          ? copy('unlimited', 'Unlimited')
                          : formatAiInteger(plan.remainingPoints, locale)
                      ],
                      [copy('planUsed', 'Used points'), formatAiInteger(plan.usedPoints, locale)],
                      [copy('planExpires', 'Expires · UTC+08:00'), date(plan.expiresAt)],
                      [copy('planResets', 'Next reset · UTC+08:00'), date(plan.resetsAt)]
                    ].map(([label, value]) => (
                      <div key={label} className="flex flex-wrap justify-between gap-2">
                        <dt>{label}</dt>
                        <dd className="break-all tabular-nums text-foreground">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          )}
          <p>
            {copy(
              'separatePoints',
              'Wallet and plan points are accounted for separately. 1 point = 1 New API quota unit.'
            )}
          </p>
        </>
      )}
    </div>
  )
}
