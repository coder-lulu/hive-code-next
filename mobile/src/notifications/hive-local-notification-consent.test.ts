import { readFileSync, existsSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeNotificationSettingsOperations } from '../settings/native-notification-settings-operations'
import { loadPushNotificationsEnabled, savePushNotificationsEnabled } from '../storage/preferences'
import { shouldPresentNotificationOptIn } from './notification-opt-in-gate'

const state = vi.hoisted(() => ({ storage: new Map<string, string>(), granted: true }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      state.storage.set(key, value)
    })
  }
}))
vi.mock('react-native', () => ({ Linking: { openSettings: vi.fn() } }))
vi.mock('./notification-permissions', () => ({
  ensureNotificationPermissions: vi.fn(async () => state.granted),
  getNotificationPermissionState: vi.fn(async () => ({
    granted: state.granted,
    status: state.granted ? 'granted' : 'denied',
    canAskAgain: state.granted,
    authorizationReflectsUserChoice: true
  }))
}))

beforeEach(() => {
  state.storage.clear()
  state.granted = true
  vi.clearAllMocks()
})

describe('Hive local notification consent', () => {
  it.each(['true', 'false'])(
    'preserves the existing local choice %s across upgrades',
    async (value) => {
      state.storage.set('orca:pushNotificationsEnabled', value)
      expect(await loadPushNotificationsEnabled()).toBe(value === 'true')
      expect(await shouldPresentNotificationOptIn()).toBe(false)
    }
  )

  it('defaults off until a local decision and remembers Not now', async () => {
    expect(await loadPushNotificationsEnabled()).toBe(false)
    expect(await shouldPresentNotificationOptIn()).toBe(true)
    await savePushNotificationsEnabled(false)
    expect(await shouldPresentNotificationOptIn()).toBe(false)
    expect(state.storage.get('orca:pushNotificationsEnabled')).toBe('false')
    expect(state.storage.has('orca:pushServiceNotificationsEnabled')).toBe(false)
  })

  it.each([true, false])(
    'persists granted=%s through native settings without enabling denied permission',
    async (granted) => {
      state.granted = granted
      const permission = await nativeNotificationSettingsOperations.permission(true)
      const saved = await nativeNotificationSettingsOperations.preference(permission.granted)
      expect(saved.enabled).toBe(granted)
      expect(state.storage.get('orca:pushNotificationsEnabled')).toBe(String(granted))
      expect(await shouldPresentNotificationOptIn()).toBe(false)
    }
  )

  it('keeps upstream remote-push attachment and native autolinking retired', () => {
    const layout = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8')
    const startup = readFileSync(new URL('../../index.js', import.meta.url), 'utf8')
    const opener = readFileSync(
      new URL('../transport/host-entry-opener.ts', import.meta.url),
      'utf8'
    )
    const onboarding = readFileSync(
      new URL('../../app/mobile-onboarding.tsx', import.meta.url),
      'utf8'
    )
    const settings = readFileSync(
      new URL('../settings/native-notification-settings-operations.ts', import.meta.url),
      'utf8'
    )
    for (const source of [layout, startup, opener, onboarding, settings]) {
      expect(source).not.toMatch(
        /attachPushRegistration|startPushTokenSync|registerPushDismissalTask|setRemotePushEnabled|notifications\.registerPush/
      )
    }
    expect(
      existsSync(
        new URL(
          '../../modules/orca-notification-dismissal/expo-module.config.json',
          import.meta.url
        )
      )
    ).toBe(false)
    expect(layout).toContain('AccountAwareNotificationResponseObserver')
    expect(onboarding).toContain('savePushNotificationsEnabled(enabled)')
  })
})
