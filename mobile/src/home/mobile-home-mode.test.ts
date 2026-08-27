import { describe, expect, it, vi } from 'vitest'
import {
  MOBILE_HOME_MODE_STORAGE_KEY,
  loadInitialMobileHomeMode,
  parseMobileHomeMode,
  persistMobileHomeMode,
  resolveInitialMobileHomeMode
} from './mobile-home-mode'

describe('mobile home mode', () => {
  it('accepts only supported persisted values', () => {
    expect(parseMobileHomeMode('cloud')).toBe('cloud')
    expect(parseMobileHomeMode('computer')).toBe('computer')
    expect(parseMobileHomeMode('remote')).toBeNull()
    expect(parseMobileHomeMode(null)).toBeNull()
  })

  it('defaults to computer mode regardless of the host catalog', () => {
    expect(resolveInitialMobileHomeMode(null, true)).toBe('computer')
    expect(resolveInitialMobileHomeMode(null, false)).toBe('computer')
  })

  it('keeps an explicit preference regardless of the host catalog', () => {
    expect(resolveInitialMobileHomeMode('cloud', true)).toBe('cloud')
    expect(resolveInitialMobileHomeMode('computer', false)).toBe('computer')
  })

  it('falls back to computer mode when storage cannot be read', async () => {
    const storage = { getItem: vi.fn().mockRejectedValue(new Error('storage unavailable')) }
    await expect(loadInitialMobileHomeMode(storage, true)).resolves.toBe('computer')
  })

  it('persists the selected mode under the versioned product key', async () => {
    const storage = { setItem: vi.fn().mockResolvedValue(undefined) }
    await persistMobileHomeMode(storage, 'cloud')
    expect(storage.setItem).toHaveBeenCalledWith(MOBILE_HOME_MODE_STORAGE_KEY, 'cloud')
  })
})
