import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { EphemeralVmsPane } from './EphemeralVmsPane'
import { getEphemeralVmsSearchEntry } from './ephemeral-vms-search'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'

type EphemeralVmsSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function EphemeralVmsSetting({
  settings,
  updateSettings
}: EphemeralVmsSettingProps): React.JSX.Element {
  const entry = getEphemeralVmsSearchEntry()
  const enabled = settings.experimentalEphemeralVms === true

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="max-w-none space-y-4 py-2"
      id="ephemeral-vms"
    >
      <div className="flex max-w-3xl items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>
            {translate('auto.components.settings.ephemeralVms.search.cloudVmTitle', 'Cloud VM')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.ephemeralVmsExperimentalSetting.description',
              'Shows setup controls and workspace run targets for repo-owned, on-demand environments.'
            )}
          </p>
        </div>
        <SettingsSwitch
          checked={enabled}
          ariaLabel={translate(
            'auto.components.settings.ephemeralVmsExperimentalSetting.cloudVmToggleLabel',
            'Toggle Cloud VM'
          )}
          onChange={() => updateSettings({ experimentalEphemeralVms: !enabled })}
        />
      </div>
      {enabled ? <EphemeralVmsPane /> : null}
    </SearchableSetting>
  )
}
