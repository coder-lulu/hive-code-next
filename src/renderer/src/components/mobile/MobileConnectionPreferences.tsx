import { ChevronDown, ExternalLink, Activity } from 'lucide-react'
import { MobileAutoRestoreFitSection } from '../settings/MobileAutoRestoreFitSection'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import { PRODUCT_PUBLIC_LINKS } from '@/product-links'
import { useAppStore } from '@/store'

export function MobileConnectionPreferences({
  onOpenConnectionDetails
}: {
  onOpenConnectionDetails: () => void
}): React.JSX.Element {
  const autoRestoreFitMs = useAppStore((s) => s.settings?.mobileAutoRestoreFitMs ?? null)
  const updateSettings = useAppStore((s) => s.updateSettings)
  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
      <p className="text-sm text-muted-foreground">
        {translate(
          'phoneConnection.sidebarPolicy',
          'The Phone connection sidebar entry is hidden after signing in to HiveCloud. Open Devices & connections from Settings at any time.'
        )}
      </p>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="group w-full justify-start px-0">
            <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
            {translate('phoneConnection.screenPreferences', 'Phone screen preferences')}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <MobileAutoRestoreFitSection
            autoRestoreFitMs={autoRestoreFitMs}
            onAutoRestoreFitChange={(ms) => void updateSettings({ mobileAutoRestoreFitMs: ms })}
          />
        </CollapsibleContent>
      </Collapsible>
      <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
        {PRODUCT_PUBLIC_LINKS.iosDownload ? (
          <Button
            variant="outline"
            onClick={() => void window.api.shell.openUrl(PRODUCT_PUBLIC_LINKS.iosDownload!)}
          >
            <ExternalLink />
            {translate('phoneConnection.iosDownload', 'Download for iOS')}
          </Button>
        ) : null}
        {PRODUCT_PUBLIC_LINKS.androidDownload ? (
          <Button
            variant="outline"
            onClick={() => void window.api.shell.openUrl(PRODUCT_PUBLIC_LINKS.androidDownload!)}
          >
            <ExternalLink />
            {translate('phoneConnection.androidDownload', 'Download for Android')}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onOpenConnectionDetails}>
          <Activity />
          {translate('phoneConnection.diagnostics', 'Connection diagnostics')}
        </Button>
        {PRODUCT_PUBLIC_LINKS.documentation ? (
          <Button
            variant="ghost"
            onClick={() => void window.api.shell.openUrl(PRODUCT_PUBLIC_LINKS.documentation!)}
          >
            <ExternalLink />
            {translate('phoneConnection.help', 'Connection help')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
