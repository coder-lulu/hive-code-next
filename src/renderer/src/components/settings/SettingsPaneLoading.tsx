import { translate } from '@/i18n/i18n'

export function SettingsPaneLoading(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={translate('components.settings.loadingPane', 'Loading settings…')}
      className="space-y-5"
    >
      <div className="space-y-2">
        <div className="h-5 w-44 animate-pulse rounded-md bg-muted" />
        <div className="h-3 w-72 max-w-full animate-pulse rounded-md bg-muted/70" />
      </div>
      <div className="h-28 animate-pulse rounded-xl border border-border/60 bg-card" />
      <div className="h-44 animate-pulse rounded-xl border border-border/60 bg-card" />
    </div>
  )
}
