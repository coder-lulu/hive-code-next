import { describe, expect, it, vi } from 'vitest'
import { RuntimeClientSettingsController } from './runtime-client-settings'
import { SettingsUpdate } from '../../shared/rpc-contract/client-settings-params'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'
import type { GlobalSettings } from '../../shared/global-settings-types'

function fixture() {
  let settings = createGlobalSettingsFixture({ workspaceDir: '/workspace' })
  const updateSettings = vi.fn((updates: Partial<GlobalSettings>) => {
    settings = { ...settings, ...updates }
  })
  const controller = new RuntimeClientSettingsController({
    getSettings: () => settings,
    updateSettings
  })
  return {
    controller,
    updateSettings,
    setSettings: (value: GlobalSettings) => {
      settings = value
    }
  }
}

describe('paired current native chat defaults', () => {
  it('keeps consent separate from an unavailable host sharing service', () => {
    const settings = createGlobalSettingsFixture({
      artifactSharingEnabled: true,
      agentSkillSharingEnabled: true,
      agentPermissionDefault: 'ask'
    })
    const controller = new RuntimeClientSettingsController(
      { getSettings: () => settings },
      undefined,
      { artifacts: () => false, skills: () => false }
    )
    const projected = controller.get()
    expect(projected).not.toHaveProperty('artifactSharingEnabled')
    expect(projected).not.toHaveProperty('agentSkillSharingEnabled')
    expect(projected.agentPermissionDefault).toBe('ask')
    expect(settings.artifactSharingEnabled).toBe(true)
    expect(settings.agentSkillSharingEnabled).toBe(true)
  })
  it('publishes explicit current choices and refuses retired fields as public settings', () => {
    const f = fixture()
    f.setSettings(
      Object.assign(
        createGlobalSettingsFixture({
          workspaceDir: '/workspace',
          nativeChatProviders: { codex: false, claude: true }
        }),
        {
          experimentalNativeChat: false,
          nativeChatPermissionMode: 'yolo'
        }
      )
    )
    const projected = f.controller.get()
    expect(projected).toHaveProperty('nativeChatProviders', { codex: false, claude: true })
    expect(Object.hasOwn(projected, 'experimentalNativeChat')).toBe(false)
    expect(Object.hasOwn(projected, 'nativeChatPermissionMode')).toBe(false)
  })
  it('normalizes the current projection without treating malformed values as user opt-outs', () => {
    const f = fixture()
    f.setSettings(
      Object.assign(createGlobalSettingsFixture({ workspaceDir: '/workspace' }), {
        nativeChatProviders: { codex: 'false', claude: false, retired: false }
      })
    )
    expect(f.controller.get()).toHaveProperty('nativeChatProviders', { claude: false })
  })
  it('saves current explicit choices and returns the actual host readback', async () => {
    const f = fixture()
    const updates = SettingsUpdate.parse({ nativeChatProviders: { codex: false } })
    await expect(f.controller.update(updates)).resolves.toHaveProperty('nativeChatProviders', {
      codex: false
    })
    expect(f.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ nativeChatProviders: { codex: false } }),
      { notifyListeners: true }
    )
  })
  it.each([
    { nativeChatPermissionMode: 'full-access' },
    { experimentalNativeChat: true },
    { nativeChatProviders: { retired: false } },
    { nativeChatProviders: { codex: 'false' } },
    { nativeChatProviders: [] }
  ])('rejects retired or malformed wire input %j', (updates) => {
    expect(SettingsUpdate.safeParse(updates).success).toBe(false)
  })
})

describe('current permission wire to durable settings projection', () => {
  it.each(['own', 'ask', 'accept-edits', 'auto', 'full-access'] as const)(
    'persists real wire choice %s and reads it back with provider denial',
    async (choice) => {
      const f = fixture()
      const updates = SettingsUpdate.parse({
        agentPermissionDefault: choice,
        agentPermissionOverrides: { claude: 'own', codex: 'ask' },
        nativeChatProviders: { codex: false }
      })
      const result = await f.controller.update(updates)
      expect(result).toMatchObject(updates)
      expect(f.controller.get()).toMatchObject(updates)
      expect(f.updateSettings).toHaveBeenCalledWith(expect.objectContaining(updates), {
        notifyListeners: true
      })
    }
  )

  it('defaults known absent permission settings to Own without inferring argv', () => {
    const f = fixture()
    const settings = createGlobalSettingsFixture({
      workspaceDir: '/workspace',
      agentDefaultArgs: { claude: '--dangerously-skip-permissions' }
    })
    delete settings.agentPermissionDefault
    delete settings.agentPermissionOverrides
    f.setSettings(settings)
    expect(f.controller.get()).toMatchObject({
      agentPermissionDefault: 'own',
      agentPermissionOverrides: {},
      nativeChatProviders: {}
    })
  })

  it('normalizes malformed persisted overrides using current keys and choices', () => {
    const f = fixture()
    f.setSettings(
      Object.assign(createGlobalSettingsFixture({ workspaceDir: '/workspace' }), {
        agentPermissionDefault: 'retired',
        agentPermissionOverrides: { codex: 'ask', claude: 'retired', missing: 'full-access' }
      })
    )
    expect(f.controller.get()).toMatchObject({
      agentPermissionDefault: 'own',
      agentPermissionOverrides: { codex: 'ask' }
    })
  })

  it.each<{ input: unknown }>(
    [
      { agentPermissionDefault: 'yolo' },
      { agentPermissionDefault: null },
      { agentPermissionOverrides: { missing: 'ask' } },
      { agentPermissionOverrides: { toString: 'ask' } },
      { agentPermissionOverrides: { claude: true } },
      { agentPermissionOverrides: { claude: 'retired' } },
      { agentPermissionOverrides: [] },
      { newChatPermissionMode: 'full-access' },
      { newChatPermissionOverrides: { codex: 'ask' } }
    ].map((input) => ({ input }))
  )('rejects malformed/retired wire input without mutation %j', ({ input }) => {
    const f = fixture()
    expect(() => SettingsUpdate.parse(input)).toThrow()
    expect(f.updateSettings).not.toHaveBeenCalled()
  })

  it.each([null, undefined, false, []].map((settings: unknown) => [settings] as const))(
    'refuses unknown settings %j before any update',
    async (settings) => {
      const f = fixture()
      // Deliberately violate the store boundary to exercise runtime validation.
      f.setSettings(settings as GlobalSettings)
      expect(() => f.controller.get()).toThrow()
      await expect(
        f.controller.update(SettingsUpdate.parse({ agentPermissionDefault: 'own' }))
      ).rejects.toThrow()
      expect(f.updateSettings).not.toHaveBeenCalled()
    }
  )

  it('returns the stored result, not an optimistic echo of submitted settings', async () => {
    const settings = createGlobalSettingsFixture({
      workspaceDir: '/workspace',
      agentPermissionDefault: 'ask'
    })
    const controller = new RuntimeClientSettingsController({
      getSettings: () => settings,
      updateSettings: () => {}
    })
    const response = await controller.update(
      SettingsUpdate.parse({ agentPermissionDefault: 'full-access' })
    )
    expect(response.agentPermissionDefault).toBe('ask')
  })
})
