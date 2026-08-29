// Bump the preference namespace so users who only ever saw the legacy computer
// home are introduced to the product's current cloud-first home after upgrade.
export const MOBILE_HOME_MODE_STORAGE_KEY = 'hivecode.mobile.home-mode.v2'

export const MOBILE_HOME_MODES = ['cloud', 'computer'] as const

export type MobileHomeMode = (typeof MOBILE_HOME_MODES)[number]

export interface MobileHomeModeStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export function parseMobileHomeMode(value: unknown): MobileHomeMode | null {
  return value === 'cloud' || value === 'computer' ? value : null
}

export function resolveInitialMobileHomeMode(
  storedMode: unknown,
  _hasPairedHosts: boolean
): MobileHomeMode {
  return parseMobileHomeMode(storedMode) ?? 'cloud'
}

export async function loadInitialMobileHomeMode(
  storage: Pick<MobileHomeModeStorage, 'getItem'>,
  hasPairedHosts: boolean
): Promise<MobileHomeMode> {
  const storedMode = await storage.getItem(MOBILE_HOME_MODE_STORAGE_KEY).catch(() => null)
  return resolveInitialMobileHomeMode(storedMode, hasPairedHosts)
}

export async function persistMobileHomeMode(
  storage: Pick<MobileHomeModeStorage, 'setItem'>,
  mode: MobileHomeMode
): Promise<void> {
  await storage.setItem(MOBILE_HOME_MODE_STORAGE_KEY, mode)
}
