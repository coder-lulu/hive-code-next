import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import {
  installApi,
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

describe('web settings preload API', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves a stored branch auto-rename opt-out without a marker', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({ autoRenameBranchFromWork: false })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      autoRenameBranchFromWork?: boolean
      autoRenameBranchFromWorkDefaultedOn?: boolean
    }

    expect(settings.autoRenameBranchFromWork).toBe(false)
    expect(Object.hasOwn(settings, 'autoRenameBranchFromWorkDefaultedOn')).toBe(false)
    expect(stored.autoRenameBranchFromWork).toBe(false)
    expect(Object.hasOwn(stored, 'autoRenameBranchFromWorkDefaultedOn')).toBe(false)
  })

  it('preserves an explicit terminal bar cursor in current web settings', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem('orca.web.settings.v1', JSON.stringify({ terminalCursorStyle: 'bar' }))
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      terminalCursorStyle?: string
      terminalCursorStyleDefaultedToBlock?: boolean
    }

    expect(settings.terminalCursorStyle).toBe('bar')
    expect(Object.hasOwn(settings, 'terminalCursorStyleDefaultedToBlock')).toBe(false)
    expect(stored.terminalCursorStyle).toBe('bar')
    expect(Object.hasOwn(stored, 'terminalCursorStyleDefaultedToBlock')).toBe(false)
  })

  it('preserves terminal cursor choices after the web block-default migration', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({
        terminalCursorStyle: 'bar',
        terminalCursorStyleDefaultedToBlock: true
      })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    expect(settings.terminalCursorStyle).toBe('bar')
    expect(Object.hasOwn(settings, 'terminalCursorStyleDefaultedToBlock')).toBe(false)
  })

  it('mirrors the host-owned agent skill sharing capability without granting it', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          return Promise.resolve({
            id: `call-${runtimeCalls.length}`,
            ok: true,
            result: { settings: { agentSkillSharingEnabled: false } },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    await globals.window.api.settings.set({ agentSkillSharingEnabled: true })
    const refreshed = await globals.window.api.settings.get()

    expect(settings.agentSkillSharingEnabled).toBe(false)
    expect(refreshed.agentSkillSharingEnabled).toBe(false)
    expect(runtimeCalls).toEqual([
      { method: 'settings.get', params: undefined },
      { method: 'settings.get', params: undefined }
    ])
    expect(runtimeCalls).not.toContainEqual(expect.objectContaining({ method: 'settings.update' }))
  })

  it('normalizes terminal cursor style before web settings writes return or persist', async () => {
    const { api, storage } = await installApi('Linux')

    const invalid = await api.settings.set({ terminalCursorStyle: 'beam' as never })
    const invalidStored = JSON.parse(storage.getItem('orca.web.settings.v1') ?? '{}') as {
      terminalCursorStyle?: string
      terminalCursorStyleDefaultedToBlock?: boolean
    }
    expect(invalid.terminalCursorStyle).toBe('block')
    expect(Object.hasOwn(invalid, 'terminalCursorStyleDefaultedToBlock')).toBe(false)
    expect(invalidStored.terminalCursorStyle).toBe('block')
    expect(Object.hasOwn(invalidStored, 'terminalCursorStyleDefaultedToBlock')).toBe(false)

    const valid = await api.settings.set({ terminalCursorStyle: 'bar' })
    expect(valid.terminalCursorStyle).toBe('bar')
    expect(JSON.parse(storage.getItem('orca.web.settings.v1') ?? '{}').terminalCursorStyle).toBe(
      'bar'
    )
  })

  it('preserves stored OSC 52 clipboard denial without a marker', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({ terminalAllowOsc52Clipboard: false })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      terminalAllowOsc52Clipboard?: boolean
      terminalAllowOsc52ClipboardDefaultedOnForAllUsers?: boolean
    }

    expect(settings.terminalAllowOsc52Clipboard).toBe(false)
    expect(Object.hasOwn(settings, 'terminalAllowOsc52ClipboardDefaultedOnForAllUsers')).toBe(false)
    expect(stored.terminalAllowOsc52Clipboard).toBe(false)
    expect(Object.hasOwn(stored, 'terminalAllowOsc52ClipboardDefaultedOnForAllUsers')).toBe(false)
  })

  it('does not arm an OSC 52 upgrade notice for an explicit opt-out', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({ terminalAllowOsc52Clipboard: false })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    await globals.window.api.settings.get()
    const storedUi = JSON.parse(globals.storage.getItem('orca.web.ui.v1') ?? '{}') as {
      osc52ClipboardDefaultOnNoticePending?: boolean
    }

    expect(storedUi.osc52ClipboardDefaultOnNoticePending).not.toBe(true)
  })

  it('does not arm the OSC 52 notice for a web profile with no persisted value', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem('orca.web.settings.v1', JSON.stringify({ terminalFontSize: 15 }))
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    await globals.window.api.settings.get()
    const storedUi = JSON.parse(globals.storage.getItem('orca.web.ui.v1') ?? '{}') as {
      osc52ClipboardDefaultOnNoticePending?: boolean
    }

    expect(storedUi.osc52ClipboardDefaultOnNoticePending).not.toBe(true)
  })

  it('does not arm a retired notice when ui.get reads newly persisted settings', async () => {
    const globals = installBrowserGlobals('Linux')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({ terminalAllowOsc52Clipboard: false })
    )

    const ui = await globals.window.api.ui.get()

    expect(ui.osc52ClipboardDefaultOnNoticePending).not.toBe(true)
  })

  it('preserves OSC 52 clipboard denial and drops a retired marker', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({
        terminalAllowOsc52Clipboard: false,
        terminalAllowOsc52ClipboardDefaultedOnForAllUsers: true
      })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    expect(settings.terminalAllowOsc52Clipboard).toBe(false)
    expect(Object.hasOwn(settings, 'terminalAllowOsc52ClipboardDefaultedOnForAllUsers')).toBe(false)
  })

  it('preserves branch auto-rename denial and drops a retired marker', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({
        autoRenameBranchFromWork: false,
        autoRenameBranchFromWorkDefaultedOn: true
      })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      autoRenameBranchFromWork?: boolean
      autoRenameBranchFromWorkDefaultedOn?: boolean
    }

    expect(settings.autoRenameBranchFromWork).toBe(false)
    expect(Object.hasOwn(settings, 'autoRenameBranchFromWorkDefaultedOn')).toBe(false)
    expect(stored.autoRenameBranchFromWork).toBe(false)
    expect(Object.hasOwn(stored, 'autoRenameBranchFromWorkDefaultedOn')).toBe(false)
  })

  it('persists branch auto-rename opt-outs without a retired marker', async () => {
    const { api, storage } = await installApi('Linux')

    const settings = await api.settings.set({
      autoRenameBranchFromWork: false,
      terminalAllowOsc52Clipboard: false
    })
    expect(settings.terminalAllowOsc52Clipboard).toBe(false)
    expect((await api.settings.get()).terminalAllowOsc52Clipboard).toBe(false)
    const stored = JSON.parse(storage.getItem('orca.web.settings.v1') ?? '{}') as {
      autoRenameBranchFromWork?: boolean
      autoRenameBranchFromWorkDefaultedOn?: boolean
    }

    expect(settings.autoRenameBranchFromWork).toBe(false)
    expect(Object.hasOwn(settings, 'autoRenameBranchFromWorkDefaultedOn')).toBe(false)
    expect(stored.autoRenameBranchFromWork).toBe(false)
    expect(Object.hasOwn(stored, 'autoRenameBranchFromWorkDefaultedOn')).toBe(false)
  })

  it('hydrates compact worktree cards from paired runtime settings', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          return Promise.resolve({
            id: `call-${runtimeCalls.length}`,
            ok: true,
            result: {
              settings: {
                compactWorktreeCards: true,
                activeRuntimeEnvironmentId: 'host-internal-default'
              }
            },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      compactWorktreeCards?: boolean
    }

    expect(settings.compactWorktreeCards).toBe(true)
    expect(settings.activeRuntimeEnvironmentId).toBeNull()
    expect(stored.compactWorktreeCards).toBe(true)
    expect(stored).not.toHaveProperty('activeRuntimeEnvironmentId')
    expect(runtimeCalls).toEqual([{ method: 'settings.get', params: undefined }])
  }, 15_000)

  it('rejects settings when the paired host is removed mid-read', async () => {
    let resolveSettings!: (value: RuntimeRpcResponse<unknown>) => void
    const settingsRead = new Promise<RuntimeRpcResponse<unknown>>(
      (resolve) => (resolveSettings = resolve)
    )
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(): Promise<RuntimeRpcResponse<unknown>> {
          return settingsRead
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({ worktreeVisibilityDefaults: { external: 'hide' } })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    const environment = (await globals.window.api.runtimeEnvironments.list())[0]!
    const read = globals.window.api.settings.get()

    await globals.window.api.runtimeEnvironments.remove({ selector: environment.id })
    resolveSettings({
      id: 'settings-read',
      ok: true,
      result: {
        settings: {
          compactWorktreeCards: true,
          worktreeVisibilityDefaults: { external: 'show' }
        }
      },
      _meta: { runtimeId: 'runtime-1' }
    })

    await expect(read).rejects.toThrow('Settings pairing changed')
    expect(
      JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}').compactWorktreeCards
    ).not.toBe(true)
    expect(JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}')).toMatchObject({
      worktreeVisibilityDefaults: { external: 'hide' }
    })
  })

  it('hydrates and updates worktree source defaults owned by a paired runtime', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          const sourcePreferences =
            method === 'settings.update'
              ? { builtIn: { claude: 'show' as const } }
              : { builtIn: { claude: 'hide' as const } }
          return Promise.resolve({
            id: `call-${runtimeCalls.length}`,
            ok: true,
            result: {
              settings: {
                worktreeVisibilityDefaults: {
                  external: method === 'settings.update' ? 'show' : 'hide',
                  customSources: [{ id: 'remote', rootPath: '/srv/remote' }],
                  sourcePreferences
                }
              }
            },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({
        worktreeVisibilityDefaults: {
          external: 'show',
          customSources: [{ id: 'local', rootPath: '/srv/local' }]
        }
      })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    expect((await globals.window.api.settings.get()).worktreeVisibilityDefaults).toEqual({
      external: 'hide',
      customSources: [{ id: 'remote', rootPath: '/srv/remote' }],
      sourcePreferences: { builtIn: { claude: 'hide' } }
    })
    expect(
      JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}').worktreeVisibilityDefaults
    ).toEqual({
      external: 'show',
      customSources: [{ id: 'local', rootPath: '/srv/local' }]
    })
    expect(
      (
        await globals.window.api.settings.set({
          worktreeVisibilityDefaults: {
            external: 'show',
            sourcePreferences: { builtIn: { claude: 'show' } }
          }
        })
      ).worktreeVisibilityDefaults
    ).toEqual({
      external: 'show',
      customSources: [{ id: 'remote', rootPath: '/srv/remote' }],
      sourcePreferences: { builtIn: { claude: 'show' } }
    })
    expect(
      JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}').worktreeVisibilityDefaults
    ).toEqual({
      external: 'show',
      customSources: [{ id: 'local', rootPath: '/srv/local' }]
    })
    expect(runtimeCalls).toEqual([
      { method: 'settings.get', params: undefined },
      {
        method: 'settings.update',
        params: {
          worktreeVisibilityDefaults: {
            external: 'show',
            customSources: [{ id: 'remote', rootPath: '/srv/remote' }],
            sourcePreferences: { builtIn: { claude: 'show' } }
          }
        }
      }
    ])
  })

  it('does not persist a paired runtime visibility update as the local default', async () => {
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string): Promise<RuntimeRpcResponse<unknown>> {
          return Promise.resolve({
            id: method,
            ok: true,
            result: {
              settings: {
                worktreeVisibilityDefaults: {
                  external: method === 'settings.update' ? 'show' : 'hide'
                }
              }
            },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({ worktreeVisibilityDefaults: { external: 'hide' } })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    await globals.window.api.settings.get()

    await globals.window.api.settings.set({
      worktreeVisibilityDefaults: { external: 'show' }
    })

    expect(
      JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}').worktreeVisibilityDefaults
    ).toEqual({ external: 'hide' })
  })

  it('rejects a failed paired visibility write after preserving local-only fields', async () => {
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string): Promise<RuntimeRpcResponse<unknown>> {
          if (method === 'settings.update') {
            return Promise.reject(new Error('offline'))
          }
          return Promise.resolve({
            id: method,
            ok: true,
            result: {
              settings: { worktreeVisibilityDefaults: { external: 'hide' } }
            },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    globals.storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({ worktreeVisibilityDefaults: { external: 'show' } })
    )
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    await globals.window.api.settings.get()

    await expect(
      globals.window.api.settings.set({
        terminalFontSize: 15,
        worktreeVisibilityDefaults: { external: 'show' }
      })
    ).rejects.toThrow('offline')

    expect(JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}')).toMatchObject({
      terminalFontSize: 15,
      worktreeVisibilityDefaults: { external: 'show' }
    })
  })

  it('does not send the additive visibility field to an older paired runtime', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          return Promise.resolve({
            id: `call-${runtimeCalls.length}`,
            ok: true,
            result: { settings: {} },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    expect((await globals.window.api.settings.get()).worktreeVisibilityDefaults).toBeUndefined()
    const settings = await globals.window.api.settings.set({
      worktreeVisibilityDefaults: { external: 'show' }
    })

    expect(settings.worktreeVisibilityDefaults).toBeUndefined()
    expect(runtimeCalls).toEqual([{ method: 'settings.get', params: undefined }])
  })

  it('hydrates new worktree card style from a paired runtime', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          return Promise.resolve({
            id: `call-${runtimeCalls.length}`,
            ok: true,
            result: { settings: { experimentalNewWorktreeCardStyle: true } },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      experimentalNewWorktreeCardStyle?: boolean
    }

    expect(settings.experimentalNewWorktreeCardStyle).toBe(true)
    expect(stored.experimentalNewWorktreeCardStyle).toBe(true)
    expect(runtimeCalls).toEqual([{ method: 'settings.get', params: undefined }])
  })

  it('hydrates MiniMax usage settings from a paired runtime', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          return Promise.resolve({
            id: `call-${runtimeCalls.length}`,
            ok: true,
            result: {
              settings: {
                minimaxGroupId: 'group-42',
                minimaxUsageModels: 'general,abab6.5',
                minimaxEndpoint: 'cn'
              }
            },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()
    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      minimaxGroupId?: string
      minimaxUsageModels?: string
      minimaxEndpoint?: string
    }

    expect(settings.minimaxGroupId).toBe('group-42')
    expect(settings.minimaxUsageModels).toBe('general,abab6.5')
    expect(settings.minimaxEndpoint).toBe('cn')
    expect(stored.minimaxGroupId).toBe('group-42')
    expect(stored.minimaxUsageModels).toBe('general,abab6.5')
    expect(stored.minimaxEndpoint).toBe('cn')
    expect(runtimeCalls).toEqual([{ method: 'settings.get', params: undefined }])
  })

  it('hydrates bot-author overrides from paired runtime settings', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          return Promise.resolve({
            id: 'call-1',
            ok: true,
            result: { settings: { prBotAuthorOverrides: [' GretelFlux ', 'gretelflux'] } },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.get()

    expect(settings.prBotAuthorOverrides).toEqual(['gretelflux'])
    expect(runtimeCalls).toEqual([{ method: 'settings.get', params: undefined }])
  })

  it('forwards compact worktree card updates to a paired runtime', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          return Promise.resolve({
            id: `call-${runtimeCalls.length}`,
            ok: true,
            result: {
              settings: {
                compactWorktreeCards: true,
                activeRuntimeEnvironmentId: 'host-internal-default'
              }
            },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.set({ compactWorktreeCards: true })

    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      compactWorktreeCards?: boolean
    }

    expect(settings.compactWorktreeCards).toBe(true)
    expect(settings.activeRuntimeEnvironmentId).toBeNull()
    expect(stored.compactWorktreeCards).toBe(true)
    expect(stored).not.toHaveProperty('activeRuntimeEnvironmentId')
    expect(runtimeCalls).toEqual([
      { method: 'settings.update', params: { compactWorktreeCards: true } }
    ])
  }, 15_000)

  it('forwards new worktree card style updates to a paired runtime', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          return Promise.resolve({
            id: `call-${runtimeCalls.length}`,
            ok: true,
            result: { settings: { experimentalNewWorktreeCardStyle: true } },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.set({
      experimentalNewWorktreeCardStyle: true
    })

    expect(settings.experimentalNewWorktreeCardStyle).toBe(true)
    expect(runtimeCalls).toEqual([
      { method: 'settings.update', params: { experimentalNewWorktreeCardStyle: true } }
    ])
  })

  it('forwards MiniMax usage setting updates to a paired runtime', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          return Promise.resolve({
            id: `call-${runtimeCalls.length}`,
            ok: true,
            result: {
              settings: {
                minimaxGroupId: 'group-42',
                minimaxUsageModels: 'general,abab6.5',
                minimaxEndpoint: 'cn'
              }
            },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.set({
      minimaxGroupId: 'group-42',
      minimaxUsageModels: 'general,abab6.5',
      minimaxEndpoint: 'cn'
    })

    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      minimaxGroupId?: string
      minimaxUsageModels?: string
      minimaxEndpoint?: string
    }

    expect(settings.minimaxGroupId).toBe('group-42')
    expect(settings.minimaxUsageModels).toBe('general,abab6.5')
    expect(settings.minimaxEndpoint).toBe('cn')
    expect(stored.minimaxGroupId).toBe('group-42')
    expect(stored.minimaxUsageModels).toBe('general,abab6.5')
    expect(stored.minimaxEndpoint).toBe('cn')
    expect(runtimeCalls).toEqual([
      {
        method: 'settings.update',
        params: {
          minimaxGroupId: 'group-42',
          minimaxUsageModels: 'general,abab6.5',
          minimaxEndpoint: 'cn'
        }
      }
    ])
  })

  it('forwards normalized bot-author overrides to a paired runtime', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          return Promise.resolve({
            id: 'call-1',
            ok: true,
            result: { settings: { prBotAuthorOverrides: ['gretelflux'] } },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.set({
      prBotAuthorOverrides: [' GretelFlux ', 'gretelflux']
    })

    expect(settings.prBotAuthorOverrides).toEqual(['gretelflux'])
    expect(runtimeCalls).toEqual([
      { method: 'settings.update', params: { prBotAuthorOverrides: ['gretelflux'] } }
    ])
  })

  it('atomically updates a bot-author override through a paired runtime', async () => {
    const runtimeCalls: { method: string; params: unknown }[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> {
          runtimeCalls.push({ method, params })
          return Promise.resolve({
            id: 'call-1',
            ok: true,
            result: { settings: { prBotAuthorOverrides: ['gretelflux'] } },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const settings = await globals.window.api.settings.updatePRBotAuthorOverride({
      author: 'gretelflux',
      isBot: true
    })

    expect(settings.prBotAuthorOverrides).toEqual(['gretelflux'])
    expect(runtimeCalls).toEqual([
      {
        method: 'settings.updatePRBotAuthorOverride',
        params: { author: 'gretelflux', isBot: true }
      }
    ])
  })

  it('does not claim a paired bot-author update succeeded when the runtime rejects it', async () => {
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(): Promise<RuntimeRpcResponse<unknown>> {
          return Promise.reject(new Error('runtime unavailable'))
        }

        close(): void {}
      }
    }))

    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    await expect(
      globals.window.api.settings.updatePRBotAuthorOverride({
        author: 'gretelflux',
        isBot: true
      })
    ).rejects.toThrow('runtime unavailable')

    const stored = JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}') as {
      prBotAuthorOverrides?: string[]
    }
    expect(stored.prBotAuthorOverrides).toBeUndefined()
  })
})
