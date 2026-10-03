import { describe, expect, it, vi } from 'vitest'
import {
  MOBILE_THEME_PREFERENCE_KEY,
  loadMobileThemePreference,
  parseMobileThemePreference,
  saveMobileThemePreference
} from './mobile-theme-preference'

describe('mobile theme preference', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', 'system'],
    ['invalid', 'system'],
    [null, 'system']
  ])('parses %j as %s', (value, expected) => {
    expect(parseMobileThemePreference(value)).toBe(expected)
  })

  it('loads a valid preference and fails closed to system', async () => {
    await expect(
      loadMobileThemePreference({ getItem: vi.fn().mockResolvedValue('dark'), setItem: vi.fn() })
    ).resolves.toBe('dark')
    await expect(
      loadMobileThemePreference({
        getItem: vi.fn().mockRejectedValue(new Error('locked')),
        setItem: vi.fn()
      })
    ).resolves.toBe('system')
  })

  it('persists only the normalized preference key and reports failures', async () => {
    const setItem = vi.fn().mockResolvedValue(undefined)
    await expect(saveMobileThemePreference({ getItem: vi.fn(), setItem }, 'light')).resolves.toBe(
      true
    )
    expect(setItem).toHaveBeenCalledWith(MOBILE_THEME_PREFERENCE_KEY, 'light')

    await expect(
      saveMobileThemePreference(
        { getItem: vi.fn(), setItem: vi.fn().mockRejectedValue(new Error('locked')) },
        'dark'
      )
    ).resolves.toBe(false)
  })
})
