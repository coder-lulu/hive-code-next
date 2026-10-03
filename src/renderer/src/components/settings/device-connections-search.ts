import { rankSettingsSearchItems, type SettingsSearchEntry } from './settings-search'
import { getMobileSettingsPaneSearchEntries } from './mobile-settings-search'
import { getMobilePaneSearchEntries } from './mobile-pane-search'
import { getSshPaneSearchEntries } from './ssh-search'
import {
  getRuntimeEnvironmentsSearchEntry,
  getWebRuntimeEnvironmentsSearchEntry
} from './runtime-environments-search'
import { getEphemeralVmsSearchEntry } from './ephemeral-vms-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export function getDeviceConnectionsSearchEntries({
  isWebClient
}: {
  isWebClient: boolean
}): SettingsSearchEntry[] {
  return [
    {
      ...(isWebClient
        ? getWebRuntimeEnvironmentsSearchEntry()
        : getRuntimeEnvironmentsSearchEntry()),
      targetSectionId: 'devices-hosts'
    },
    ...(!isWebClient
      ? getSshPaneSearchEntries().map((entry) => ({ ...entry, targetSectionId: 'devices-ssh' }))
      : []),
    ...(!isWebClient
      ? getMobileSettingsPaneSearchEntries().map((entry) => ({
          ...entry,
          targetSectionId: getMobilePaneSearchEntries().some(
            (direct) => direct.title === entry.title
          )
            ? 'devices-direct'
            : 'devices-this-computer'
        }))
      : []),
    ...(!isWebClient
      ? [
          {
            title: translate('deviceConnections.access', 'Access management'),
            description: translate(
              'deviceConnections.accessDescription',
              'Manage cloud sessions, phone pairing and shared access here. Each revoke action affects only the selected access type. Manage account sign-in devices in Account settings.'
            ),
            keywords: translateSearchKeyword('deviceConnections.access', 'Access management', {
              aliases: ['HiveCloud']
            }),
            targetSectionId: 'devices-access'
          }
        ]
      : [])
  ]
}

export function getDeviceConnectionsSearchTarget(
  query: string,
  isWebClient: boolean
): string | null {
  if (!query.trim()) {
    return null
  }
  return (
    rankSettingsSearchItems(
      query,
      getDeviceConnectionsSearchEntries({ isWebClient }),
      (entry) => entry
    )[0]?.item.targetSectionId ?? null
  )
}

export function getWorkEnvironmentsSearchEntries(): SettingsSearchEntry[] {
  return [getEphemeralVmsSearchEntry()]
}
