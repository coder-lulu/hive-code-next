import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { prepareLoadedProfileSettings } from './prepare-loaded-profile-settings'

describe('current profile task provider settings', () => {
  it('uses current defaults when the profile has no settings', () => {
    const defaults = getDefaultPersistedState('/current-profile')
    const parsed = getDefaultPersistedState('/current-profile')
    Reflect.deleteProperty(parsed, 'settings')

    const prepared = prepareLoadedProfileSettings(parsed, defaults, () => {})

    expect(prepared.settings.visibleTaskProviders).toEqual(defaults.settings.visibleTaskProviders)
    expect(prepared.settings.defaultTaskSource).toBe(defaults.settings.defaultTaskSource)
    expect(prepared.loadedCompactWorktreeCards).toBe(defaults.settings.compactWorktreeCards)
  })

  it('preserves explicit current provider choices', () => {
    const defaults = getDefaultPersistedState('/current-profile')
    const parsed = getDefaultPersistedState('/current-profile')
    parsed.settings.visibleTaskProviders = ['gitlab']
    parsed.settings.defaultTaskSource = 'gitlab'

    const prepared = prepareLoadedProfileSettings(parsed, defaults, () => {})

    expect(prepared.settings.visibleTaskProviders).toEqual(['gitlab'])
    expect(prepared.settings.defaultTaskSource).toBe('gitlab')
  })
})
