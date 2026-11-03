import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn()
}))

vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft' }))
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('../theme/mobile-theme-provider', () => ({ useMobileTheme: () => lightTheme }))
vi.mock('./BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

import { loadCustomKeys, saveCustomKeys, type CustomKey } from './CustomKeyModal'

const STORAGE_KEY = 'orca:custom-accessory-keys'

describe('custom terminal key persistence', () => {
  beforeEach(() => {
    storage.getItem.mockReset()
    storage.setItem.mockReset()
  })

  it('loads the existing key order without changing its terminal payload', async () => {
    const keys: CustomKey[] = [{ id: 'build', label: '构建', bytes: 'pnpm build\r', enter: false }]
    storage.getItem.mockResolvedValue(JSON.stringify(keys))

    await expect(loadCustomKeys()).resolves.toEqual(keys)
    expect(storage.getItem).toHaveBeenCalledWith(STORAGE_KEY)
  })

  it('fails closed when stored shortcut data cannot be read', async () => {
    storage.getItem.mockRejectedValue(new Error('storage unavailable'))

    await expect(loadCustomKeys()).resolves.toEqual([])
  })

  it('persists the complete ordered key collection under the existing key', async () => {
    const keys: CustomKey[] = [{ id: 'escape', label: 'Esc', bytes: '\u001b', enter: false }]
    storage.setItem.mockResolvedValue(undefined)

    await saveCustomKeys(keys)

    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify(keys))
  })
})
