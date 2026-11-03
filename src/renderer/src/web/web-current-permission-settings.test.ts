import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'
import { SettingsUpdate } from '../../../shared/rpc-contract/client-settings-params'

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

async function paired(settings: unknown, rejectWrite = false) {
  const calls: { method: string; params: unknown }[] = []
  vi.doMock('./web-runtime-client', () => ({
    WebRuntimeClient: class {
      async call(method: string, params: unknown) {
        calls.push({ method, params })
        if (method === 'settings.update' && rejectWrite) {
          throw new Error('host refused')
        }
        return { id: 'settings', ok: true, result: { settings }, _meta: { runtimeId: 'runtime-1' } }
      }
      close() {}
    }
  }))
  const globals = installBrowserGlobals('Linux')
  writeStoredRuntimeEnvironment(globals.storage)
  const { installWebPreloadApi } = await import('./web-preload-api')
  installWebPreloadApi()
  return { ...globals, calls, api: globals.window.api }
}

describe('current web permission settings', () => {
  it('reads current host provider denial and typed Own without retired fields', async () => {
    const { api } = await paired({
      nativeChatProviders: { codex: false },
      agentPermissionDefault: 'ask',
      agentPermissionOverrides: { claude: 'own' },
      nativeChatPermissionMode: 'full-access'
    })
    const settings = await api.settings.get()
    expect(settings).toMatchObject({
      nativeChatProviders: { codex: false },
      agentPermissionDefault: 'ask',
      agentPermissionOverrides: { claude: 'own' }
    })
    expect(settings).not.toHaveProperty('nativeChatPermissionMode')
  })

  it('writes only current settings and preserves explicit false in the real wire schema', async () => {
    const updates = { nativeChatProviders: { codex: false } }
    const { api, calls } = await paired(updates)
    expect(await api.settings.set(updates)).toMatchObject(updates)
    const write = calls.find((call) => call.method === 'settings.update')
    expect(write?.params).toEqual(updates)
    expect(SettingsUpdate.parse(write?.params)).toEqual(updates)
  })

  it('forwards typed permission intent including Own without argv inference', async () => {
    const updates = {
      agentPermissionDefault: 'own' as const,
      agentPermissionOverrides: { claude: 'ask' as const }
    }
    const { api, calls } = await paired(updates)
    await api.settings.set(updates)
    expect(calls).toContainEqual({ method: 'settings.update', params: updates })
  })

  it.each(
    [
      null,
      undefined,
      false,
      [],
      { nativeChatProviders: { codex: 'false' } },
      { agentPermissionDefault: 'invalid' }
    ].map((settings) => [settings])
  )('refuses unknown paired settings %j', async (settings) => {
    const { api } = await paired(settings)
    await expect(api.settings.get()).rejects.toThrow()
  })

  it('does not persist or report successful permission writes rejected by the host', async () => {
    const { api, storage } = await paired({}, true)
    storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({ nativeChatProviders: { codex: false }, agentPermissionDefault: 'ask' })
    )
    await expect(
      api.settings.set({
        nativeChatProviders: { codex: true },
        agentPermissionDefault: 'full-access'
      })
    ).rejects.toThrow('host refused')
    expect(JSON.parse(storage.getItem('orca.web.settings.v1') ?? '{}')).toMatchObject({
      nativeChatProviders: { codex: false },
      agentPermissionDefault: 'ask'
    })
  })
})

describe('current local and confirmed settings', () => {
  it('defaults chat on for known empty settings while preserving explicit false', async () => {
    const { api } = await paired({})
    expect((await api.settings.get()).nativeChatProviders).toEqual({})
    const { isNativeChatDefaultFor } =
      await import('../../../shared/structured-native-chat-launch-route')
    expect(isNativeChatDefaultFor(await api.settings.get(), 'codex')).toBe(true)
  })
  it('refuses an unconfirmed successful host update', async () => {
    const { api } = await paired({})
    await expect(api.settings.set({ nativeChatProviders: { codex: false } })).rejects.toThrow(
      'Host did not confirm chat settings'
    )
  })
  it('keeps local Own and provider false while stripping retired stored and write fields', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({
        nativeChatPermissionMode: 'full-access',
        experimentalNativeChat: true,
        nativeChatProviders: { codex: false },
        agentPermissionDefault: 'own'
      })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    const settings = await globals.window.api.settings.set({ theme: 'light' })
    expect(settings).toMatchObject({
      nativeChatProviders: { codex: false },
      agentPermissionDefault: 'own'
    })
    expect(settings).not.toHaveProperty('nativeChatPermissionMode')
    expect(settings).not.toHaveProperty('experimentalNativeChat')
    expect(JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}')).not.toHaveProperty(
      'nativeChatPermissionMode'
    )
  })
})
