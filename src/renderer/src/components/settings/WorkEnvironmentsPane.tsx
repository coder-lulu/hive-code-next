import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { EphemeralVmsSetting } from './EphemeralVmsSetting'
import { EphemeralVmRuntimesSection } from './EphemeralVmRuntimesSection'
import { translate } from '@/i18n/i18n'

export function WorkEnvironmentsPane({
  settings,
  updateSettings,
  active
}: {
  settings: GlobalSettings
  updateSettings: (update: Partial<GlobalSettings>) => void
  active: boolean
}): React.JSX.Element {
  return (
    <div className="space-y-6">
      <EphemeralVmsSetting settings={settings} updateSettings={updateSettings} />
      <section className="space-y-3 border-t border-border/60 pt-5">
        <h3 className="text-sm font-semibold">
          {translate('deviceConnections.cloudMachines', 'Cloud machines')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {translate(
            'deviceConnections.cloudMachinesDescription',
            'Manage environments created from workspace recipes. Existing machines remain available for cleanup when new environment creation is disabled.'
          )}
        </p>
        <EphemeralVmRuntimesSection active={active} />
      </section>
    </div>
  )
}
