import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import { getDeviceConnectionsSearchTarget } from './device-connections-search'
import { getMobileSettingsPaneSearchEntries } from './mobile-settings-search'
import { matchesSettingsSearch } from './settings-search'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('Chinese mobile settings search', () => {
  it.each(['安卓', 'android'])('finds the phone connection settings for %s', async (query) => {
    await i18n.changeLanguage('zh')

    expect(matchesSettingsSearch(query, getMobileSettingsPaneSearchEntries())).toBe(true)
    expect(getDeviceConnectionsSearchTarget(query, false)).toBe('devices-this-computer')
  })

  it('restores the Chinese keyword after switching away and back', async () => {
    await i18n.changeLanguage('zh')
    getMobileSettingsPaneSearchEntries()
    await i18n.changeLanguage('fr')
    getMobileSettingsPaneSearchEntries()
    await i18n.changeLanguage('zh')

    expect(getDeviceConnectionsSearchTarget('安卓', false)).toBe('devices-this-computer')
  })
})
