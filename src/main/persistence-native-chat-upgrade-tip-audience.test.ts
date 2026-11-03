import {
  closeTestStores,
  testState,
  createStore,
  readDataFile,
  writeDataFile
} from './persistence/persistence-test-harness'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultPersistedState } from '../shared/constants'
import type { NativeChatUpgradeTipAudience } from '../shared/native-chat/native-chat-upgrade-tip-audience'
import { isNativeChatDefaultFor } from '../shared/structured-native-chat-launch-route'
import { normalizeProfileProjectState } from './orca-profiles/profile-project-state-file'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('./telemetry/client', () => ({ track: vi.fn() }))

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'orca-chat-upgrade-tip-audience-'))
})
afterEach(async () => {
  await closeTestStores()
  rmSync(testState.dir, { recursive: true, force: true })
})

async function reopen(): Promise<ReturnType<typeof createStore>> {
  await closeTestStores()
  return createStore()
}

describe('native chat upgrade tip audience', () => {
  it('keeps a saved terminal-view audience through current provider changes and reload', async () => {
    writeDataFile({
      settings: {},
      nativeChatUpgradeTipAudience: {
        version: 1,
        membership: 'eligible',
        basis: 'chat-ui-on-terminal-default'
      }
    })
    const store = createStore()
    expect(store.getNativeChatUpgradeTipVariant()).toBe('keep-terminal')
    store.updateSettings({ nativeChatProviders: { claude: false } })
    store.flush()
    expect((await reopen()).getNativeChatUpgradeTipVariant()).toBe('keep-terminal')
  })

  it('keeps a brand new profile out of the audience', () => {
    const store = createStore()
    expect(store.getNativeChatUpgradeTipVariant()).toBe('none')
    store.flush()
    expect(readDataFile()).not.toHaveProperty('nativeChatUpgradeTipAudience')
  })

  it('defaults current native chat views on without an opt-in flag', () => {
    const store = createStore()
    for (const agent of ['claude', 'codex', 'opencode'] as const) {
      expect(isNativeChatDefaultFor(store.getSettings(), agent)).toBe(true)
    }
    expect(Object.hasOwn(store.getSettings(), 'experimentalNativeChat')).toBe(false)
  })

  it('persists an explicit current provider opt-out without disabling other providers', async () => {
    const store = createStore()
    store.updateSettings({ nativeChatProviders: { claude: false } })
    store.flush()
    const loaded = (await reopen()).getSettings()
    expect(isNativeChatDefaultFor(loaded, 'claude')).toBe(false)
    expect(isNativeChatDefaultFor(loaded, 'codex')).toBe(true)
  })

  it('keeps an excluded saved record with current native chat enabled', async () => {
    writeDataFile({
      settings: { nativeChatProviders: { claude: true } },
      nativeChatUpgradeTipAudience: { version: 1, membership: 'excluded', basis: 'chat-ui-off' }
    })
    for (let launch = 0; launch < 3; launch += 1) {
      const store = launch === 0 ? createStore() : await reopen()
      expect(store.getNativeChatUpgradeTipVariant()).toBe('none')
      store.flush()
    }
    expect(readDataFile()).toHaveProperty('nativeChatUpgradeTipAudience.basis', 'chat-ui-off')
  })

  it('does not invent an audience from current native chat preferences', () => {
    writeDataFile({ settings: { nativeChatProviders: { claude: true } } })
    const store = createStore()
    expect(store.getNativeChatUpgradeTipVariant()).toBe('none')
    store.flush()
    expect(readDataFile()).not.toHaveProperty('nativeChatUpgradeTipAudience')
  })

  it('drops retired chat flags without disabling current native chat', () => {
    writeDataFile({
      settings: { openAgentTabsInChatByDefault: true, experimentalNativeChat: false }
    })
    const store = createStore()
    store.flush()
    expect(readDataFile()).not.toHaveProperty('settings.openAgentTabsInChatByDefault')
    expect(readDataFile()).not.toHaveProperty('settings.experimentalNativeChat')
    expect(isNativeChatDefaultFor(store.getSettings(), 'claude')).toBe(true)
  })

  it('never seeds a record or the pre-upgrade marker from defaults', () => {
    const defaults = getDefaultPersistedState('/home/test')
    expect(defaults).not.toHaveProperty('nativeChatUpgradeTipAudience')
    expect(defaults.settings).not.toHaveProperty('openAgentTabsInChatByDefault')
  })

  it.each([
    ['an unknown version', { version: 2, membership: 'eligible', basis: 'chat-ui-on' }],
    ['an unknown membership', { version: 1, membership: 'yes', basis: 'chat-ui-on' }],
    ['a non-object', 'eligible'],
    ['null', null]
  ])('fails closed on a saved record with %s', (_, record) => {
    writeDataFile({ settings: {}, nativeChatUpgradeTipAudience: record })
    const store = createStore()
    expect(store.getNativeChatUpgradeTipVariant()).toBe('none')
    store.flush()
    expect(createStore().getNativeChatUpgradeTipVariant()).toBe('none')
  })

  it('keeps a saved audience independent of current provider preferences', () => {
    writeDataFile({
      settings: { nativeChatProviders: { claude: false } },
      nativeChatUpgradeTipAudience: { version: 1, membership: 'eligible', basis: 'chat-ui-on' }
    })
    expect(createStore().getNativeChatUpgradeTipVariant()).toBe('standard')
  })

  it('profile transfers carry a saved record and never invent one', () => {
    const excluded: NativeChatUpgradeTipAudience = {
      version: 1,
      membership: 'excluded',
      basis: 'chat-ui-off'
    }
    const settings = {
      ...getDefaultPersistedState('/home/test').settings,
      nativeChatProviders: { claude: true }
    }
    expect(
      normalizeProfileProjectState({ settings, nativeChatUpgradeTipAudience: excluded })
    ).toHaveProperty('nativeChatUpgradeTipAudience', excluded)
    expect(normalizeProfileProjectState({ settings })).not.toHaveProperty(
      'nativeChatUpgradeTipAudience'
    )
  })

  it('keeps the tip dismissed when a stale client writes an older seen list', async () => {
    writeDataFile({ settings: {} })
    const store = createStore()
    store.updateUI({ featureTipsSeenIds: ['native-chat-upgrade'] })
    // A paired client hydrated before the tip was shown marks another tip seen.
    store.updateUI({ featureTipsSeenIds: ['voice-dictation'] })
    store.flush()
    expect((await reopen()).getUI().featureTipsSeenIds).toEqual([
      'native-chat-upgrade',
      'voice-dictation'
    ])
  })
})
