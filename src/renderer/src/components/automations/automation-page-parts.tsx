import React from 'react'
import type { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AutomationRun } from '../../../../shared/automations-types'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

// Cache per language so long tables do not construct a formatter for every cell.
const getAutomationDateTimeFormatter = createLocalizedCatalog(
  () =>
    new Intl.DateTimeFormat(getIntlLocale(), {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
)

export function formatAutomationDateTime(value: number | null | undefined): string {
  if (!value) {
    return translate('auto.components.automations.automation.page.parts.never', 'Never')
  }
  return getAutomationDateTimeFormatter().format(value)
}

export function formatAutomationRelativeTime(
  value: number | null | undefined,
  now = Date.now()
): string | null {
  if (!value) {
    return null
  }
  const diffMs = value - now
  const absMs = Math.abs(diffMs)
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs
  if (absMs < minuteMs) {
    return translate('auto.components.automations.automation.page.parts.relativeNow', 'now')
  }
  let text: string
  if (absMs < hourMs) {
    text = translate(
      'auto.components.automations.automation.page.parts.relativeMinutes',
      '{{value0}}m',
      {
        value0: Math.round(absMs / minuteMs)
      }
    )
  } else if (absMs < dayMs) {
    text = translate(
      'auto.components.automations.automation.page.parts.relativeHours',
      '{{value0}}h',
      {
        value0: Math.round(absMs / hourMs)
      }
    )
  } else {
    text = translate(
      'auto.components.automations.automation.page.parts.relativeDays',
      '{{value0}}d',
      {
        value0: Math.round(absMs / dayMs)
      }
    )
  }
  return diffMs >= 0
    ? translate(
        'auto.components.automations.automation.page.parts.relativeFuture',
        'in {{value0}}',
        { value0: text }
      )
    : translate(
        'auto.components.automations.automation.page.parts.relativePast',
        '{{value0}} ago',
        { value0: text }
      )
}

export function formatAutomationDateTimeWithRelative(
  value: number | null | undefined,
  now = Date.now()
): string {
  const absolute = formatAutomationDateTime(value)
  const relative = formatAutomationRelativeTime(value, now)
  return relative ? `${absolute} (${relative})` : absolute
}

export function getAutomationRunStatusVariant(
  status: AutomationRun['status']
): React.ComponentProps<typeof Badge>['variant'] {
  if (status === 'dispatched' || status === 'completed') {
    return 'secondary'
  }
  if (status.startsWith('skipped')) {
    return 'outline'
  }
  if (status === 'dispatch_failed') {
    return 'destructive'
  }
  return 'dot'
}

export function getAutomationRunStatusLabel(status: AutomationRun['status']): string {
  switch (status) {
    case 'pending':
      return translate('auto.components.automations.automation.page.parts.queued', 'Queued')
    case 'dispatching':
      return translate('auto.components.automations.automation.page.parts.starting', 'Starting')
    case 'dispatched':
      return translate('auto.components.automations.automation.page.parts.launched', 'Launched')
    case 'completed':
      return translate('auto.components.automations.automation.list.last.run.done', 'Done')
    case 'skipped_precheck':
      return translate(
        'auto.components.automations.automation.page.parts.precheckSkipped',
        'Precheck skipped'
      )
    case 'skipped_missed':
      return translate('auto.components.automations.automation.page.parts.skipped', 'Skipped')
    case 'skipped_unavailable':
      return translate(
        'auto.components.automations.automation.page.parts.unavailable',
        'Unavailable'
      )
    case 'skipped_needs_interactive_auth':
      return translate(
        'auto.components.automations.automation.page.parts.needsCredentials',
        'Needs credentials'
      )
    case 'dispatch_failed':
      return translate('auto.components.automations.automation.list.last.run.failed', 'Failed')
  }
}

export const AUTOMATION_EDITOR_SECTION_LABEL_CLASS =
  'text-[11px] font-semibold uppercase tracking-[0.05em]'

export function Field({
  label,
  children,
  className,
  labelClassName
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
  labelClassName?: string
}): React.JSX.Element {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <div className={cn('text-xs text-muted-foreground', labelClassName)}>{label}</div>
      {children}
    </div>
  )
}
