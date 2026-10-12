import { describe, expect, it } from 'vitest'
import { resolveOnboardingSettingsHydration } from './onboarding-settings-hydration'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { getDefaultSettings } from '../../../../shared/constants'

const settings: GlobalSettings = {
  ...getDefaultSettings('/tmp'),
  theme: 'light',
  defaultTuiAgent: 'codex'
}

describe('resolveOnboardingSettingsHydration', () => {
  it.each(['hivecode', 'managed-pi', 'unknown-agent', 'blank', null, undefined])(
    'does not select invalid or empty preference %s',
    (defaultTuiAgent) => {
      const persistedSettings = { ...settings }
      Reflect.set(persistedSettings, 'defaultTuiAgent', defaultTuiAgent)
      expect(
        resolveOnboardingSettingsHydration({
          settings: persistedSettings,
          settingsHydrated: false,
          themeInteracted: false,
          agentInteracted: false,
          currentTheme: 'light',
          currentAgent: null
        })
      ).toEqual({ settingsHydrated: true })
    }
  )

  it.each(['codex', 'pi'] as const)('hydrates current external agent %s', (defaultTuiAgent) => {
    expect(
      resolveOnboardingSettingsHydration({
        settings: { ...settings, defaultTuiAgent },
        settingsHydrated: false,
        themeInteracted: false,
        agentInteracted: false,
        currentTheme: 'light',
        currentAgent: null
      })
    ).toEqual({ settingsHydrated: true, selectedAgent: defaultTuiAgent })
  })

  it('does nothing before settings hydrate', () => {
    expect(
      resolveOnboardingSettingsHydration({
        settings: null,
        settingsHydrated: false,
        themeInteracted: false,
        agentInteracted: false,
        currentTheme: 'dark',
        currentAgent: null
      })
    ).toBeNull()
  })

  it('does nothing after the first settings hydration pass', () => {
    expect(
      resolveOnboardingSettingsHydration({
        settings,
        settingsHydrated: true,
        themeInteracted: false,
        agentInteracted: false,
        currentTheme: 'dark',
        currentAgent: null
      })
    ).toBeNull()
  })

  it('hydrates theme and default agent when the user has not interacted', () => {
    expect(
      resolveOnboardingSettingsHydration({
        settings,
        settingsHydrated: false,
        themeInteracted: false,
        agentInteracted: false,
        currentTheme: 'dark',
        currentAgent: null
      })
    ).toEqual({
      settingsHydrated: true,
      theme: 'light',
      selectedAgent: 'codex'
    })
  })

  it('does not overwrite fields the user already changed', () => {
    expect(
      resolveOnboardingSettingsHydration({
        settings,
        settingsHydrated: false,
        themeInteracted: true,
        agentInteracted: true,
        currentTheme: 'dark',
        currentAgent: 'claude'
      })
    ).toEqual({ settingsHydrated: true })
  })

  it('does not clear an existing agent when settings have no default agent', () => {
    expect(
      resolveOnboardingSettingsHydration({
        settings: { ...settings, defaultTuiAgent: 'blank' },
        settingsHydrated: false,
        themeInteracted: false,
        agentInteracted: false,
        currentTheme: 'light',
        currentAgent: 'claude'
      })
    ).toEqual({ settingsHydrated: true })
  })

  it('skips redundant value updates when current local state already matches settings', () => {
    expect(
      resolveOnboardingSettingsHydration({
        settings,
        settingsHydrated: false,
        themeInteracted: false,
        agentInteracted: false,
        currentTheme: 'light',
        currentAgent: 'codex'
      })
    ).toEqual({ settingsHydrated: true })
  })
})
