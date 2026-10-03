import type { MobileThemeScheme } from './mobile-theme'

export type MobileThemePreference = MobileThemeScheme | 'system'

export const MOBILE_THEME_PREFERENCE_KEY = 'hivecode.mobile.theme-preference.v1'

export interface MobileThemePreferenceStorage {
  readonly getItem: (key: string) => Promise<string | null>
  readonly setItem: (key: string, value: string) => Promise<void>
}

export function parseMobileThemePreference(value: unknown): MobileThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

export async function loadMobileThemePreference(
  storage: MobileThemePreferenceStorage
): Promise<MobileThemePreference> {
  try {
    return parseMobileThemePreference(await storage.getItem(MOBILE_THEME_PREFERENCE_KEY))
  } catch {
    return 'system'
  }
}

export async function saveMobileThemePreference(
  storage: MobileThemePreferenceStorage,
  preference: MobileThemePreference
): Promise<boolean> {
  try {
    await storage.setItem(MOBILE_THEME_PREFERENCE_KEY, preference)
    return true
  } catch {
    return false
  }
}
