import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import { getDefaultUserDataPath, getPlatformUserDataPath } from './metadata'

afterEach(() => vi.unstubAllEnvs())

describe('CLI product profile paths', () => {
  it('uses the product name on macOS and honors a caller supplied profile name', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', '')
    expect(getDefaultUserDataPath('darwin', '/home/test')).toBe(
      join('/home/test', 'Library', 'Application Support', APP_DISPLAY_NAME)
    )
    expect(getDefaultUserDataPath('darwin', '/home/test', 'profile')).toBe(
      join('/home/test', 'Library', 'Application Support', 'profile')
    )
  })

  it('keeps the platform profile separate from the explicit CLI instance override', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', '/isolated-instance')
    vi.stubEnv('XDG_CONFIG_HOME', '/xdg')
    expect(getDefaultUserDataPath('linux', '/home/test')).toBe('/isolated-instance')
    expect(getPlatformUserDataPath('linux', '/home/test')).toBe(join('/xdg', APP_DISPLAY_NAME))
  })

  it('uses the Windows profile root and refuses an unavailable APPDATA directory', () => {
    vi.stubEnv('APPDATA', 'C:/Users/test/AppData/Roaming')
    expect(getPlatformUserDataPath('win32', '/home/test')).toBe(
      join('C:/Users/test/AppData/Roaming', APP_DISPLAY_NAME)
    )
    vi.stubEnv('APPDATA', '')
    expect(() => getPlatformUserDataPath('win32', '/home/test')).toThrow(`${APP_DISPLAY_NAME} runtime`)
  })
})
