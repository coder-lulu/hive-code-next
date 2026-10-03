import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { APP_DISPLAY_NAME } from '@/product-brand'

export function AppPageLoadingFallback(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-background text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span>
        {translate('app.loadingPage', 'Loading {{value0}}…', { value0: APP_DISPLAY_NAME })}
      </span>
    </div>
  )
}
