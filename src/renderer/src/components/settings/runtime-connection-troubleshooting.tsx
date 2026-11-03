import { ChevronDown } from 'lucide-react'
import { translate } from '@/i18n/i18n'

export function RuntimeConnectionTroubleshooting(): React.JSX.Element {
  return (
    <details className="group rounded-lg border border-border/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium">
        {translate(
          'auto.components.settings.RuntimeEnvironmentsPane.troubleshootWorkflow',
          'Connection troubleshooting'
        )}
        <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-border/50 p-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">
            {translate(
              'auto.components.settings.RuntimeEnvironmentsPane.troubleshootTitle',
              'Create a new link on the other host'
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.RuntimeEnvironmentsPane.troubleshootDescription',
              'A link that uses 127.0.0.1 points back to the device opening it, not the computer that created it.'
            )}
          </p>
        </div>
        <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
          <li>
            {translate(
              'auto.components.settings.RuntimeEnvironmentsPane.troubleshootStepShare',
              'On the other computer, open Devices & connections → Connect to this computer → Direct address.'
            )}
          </li>
          <li>
            {translate(
              'auto.components.settings.RuntimeEnvironmentsPane.troubleshootStepAddress',
              'Choose Another device and select a reachable LAN or VPN address, or enter your own address.'
            )}
          </li>
          <li>
            {translate(
              'auto.components.settings.RuntimeEnvironmentsPane.troubleshootStepRegenerate',
              'Generate a new access link and use only the newest link here.'
            )}
          </li>
        </ol>
        <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
          {translate(
            'auto.components.settings.RuntimeEnvironmentsPane.troubleshootTunnel',
            'Using an SSH local forward? Open My hosts, paste the loopback link, then enable “I am using an SSH tunnel” under Advanced.'
          )}
        </div>
      </div>
    </details>
  )
}
