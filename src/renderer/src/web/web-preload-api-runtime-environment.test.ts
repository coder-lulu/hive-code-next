import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { MIN_COMPATIBLE_RUNTIME_SERVER_VERSION } from '../../../shared/protocol-version'
import { APP_DISPLAY_NAME } from '../product-brand'
import {
  encodePairingCode,
  installApi,
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

describe('web runtime environment identity', () => {
  it('rejects unsupported cloud alias writes and draft discard instead of reporting a saved result', async () => {
    const { api } = await installApi('Linux')
    await expect(
      api.hiveRuntimeCloud.updateDisplayName({
        runtimeRecordId: '11111111-1111-4111-8111-111111111111',
        cloudDisplayName: '名称',
        expectedCloudDisplayNameVersion: 1,
        expectedOwnershipEpoch: 8
      })
    ).rejects.toThrow('CAPABILITY_UNAVAILABLE')
    await expect(
      api.hiveRuntimeCloud.discardDisplayName({
        runtimeRecordId: '11111111-1111-4111-8111-111111111111',
        revision: 1
      })
    ).rejects.toThrow('CAPABILITY_UNAVAILABLE')
  })
  it('enters the existing app with the account Relay client without persisting connection material', async () => {
    const globals = installBrowserGlobals('Linux')
    const { WebAccountSession } = await import('./account-runtime-relay/web-account-session')
    const { installWebPreloadApi } = await import('./web-preload-api')
    const session = new WebAccountSession(vi.fn(), 'https://console.hivekernel.com')
    const call = vi.fn(async () => ({
      id: 'status',
      ok: true as const,
      result: {},
      _meta: { runtimeId: 'account-runtime' }
    }))
    const client = { call, close: vi.fn(), subscribe: vi.fn() }
    installWebPreloadApi(undefined, {
      runtime: {
        runtimeRecordId: '11111111-1111-4111-8111-111111111111',
        status: 'CLAIMED',
        resourceVersion: 1,
        ownershipEpoch: 8,
        cloudDisplayName: null,
        cloudDisplayNameVersion: 1,
        deviceName: 'My computer'
      },
      session,
      client
    })
    const [environment] = await globals.window.api.runtimeEnvironments.list()
    await globals.window.api.runtimeEnvironments.getStatus({ selector: environment!.id })
    expect(call).toHaveBeenCalledWith('status.get', undefined, { timeoutMs: undefined })
    expect(globals.storage.getItem('orca.web.runtimeEnvironment.v1')).toBeNull()
    expect((await globals.window.api.hiveAccount.getState()).status).toBe('signed-in')
    session.close()
  })
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('./web-runtime-client')
  })

  it('keeps a Cloud-managed bootstrap volatile across Runtime status updates', async () => {
    const constructedWith: unknown[] = []
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        constructor(connection: unknown) {
          constructedWith.push(connection)
        }

        call(method: string): Promise<RuntimeRpcResponse<unknown>> {
          return Promise.resolve({
            id: method,
            ok: true,
            result: { runtimeId: 'runtime-cloud' },
            _meta: { runtimeId: 'runtime-cloud' }
          })
        }

        close(): void {}
      }
    }))
    const globals = installBrowserGlobals('Linux')
    const bootstrap = {
      protocolVersion: 'cloud-launch/v1' as const,
      managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
      runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
      websocketUrl: 'wss://runtime.example/_hive/runtime-rpc',
      serverPublicKeyB64: 'server-public-key',
      sessionToken: 'A'.repeat(43),
      expiresAt: '2026-08-25T09:00:00.000Z',
      runtimeDisplayMetadata: {
        runtimeRecordId: '423e4567-e89b-42d3-a456-426614174000',
        resourceVersion: 7,
        ownershipEpoch: 8,
        cloudDisplayName: null,
        cloudDisplayNameVersion: 1,
        deviceName: '设备'
      }
    }
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi(bootstrap)

    const [environment] = await globals.window.api.runtimeEnvironments.list()
    await globals.window.api.runtimeEnvironments.getStatus({ selector: environment!.id })

    expect(constructedWith).toEqual([bootstrap])
    expect(globals.storage.getItem('orca.web.runtimeEnvironment.v1')).toBeNull()
    expect(JSON.stringify(await globals.window.api.runtimeEnvironments.list())).not.toContain(
      bootstrap.sessionToken
    )
  })

  it('does not resolve an old server selector through a differently keyed server', async () => {
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    await globals.window.api.runtimeEnvironments.addFromPairingCode({
      name: 'Server B',
      pairingCode: encodePairingCode({ publicKeyB64: 'server-b-key' })
    })

    await expect(
      globals.window.api.runtimeEnvironments.resolve({ selector: 'web-server-a' })
    ).rejects.toThrow(`Unknown ${APP_DISPLAY_NAME} runtime environment: web-server-a`)
  })

  it('keeps pairing state separate from generic Active Server settings writes', async () => {
    const globals = installBrowserGlobals('Linux')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    const paired = await globals.window.api.runtimeEnvironments.addFromPairingCode({
      name: 'Windows 2',
      pairingCode: encodePairingCode({ publicKeyB64: 'windows-2-key' })
    })

    const settings = await globals.window.api.settings.set({ activeRuntimeEnvironmentId: null })

    await expect(globals.window.api.runtimeEnvironments.list()).resolves.toMatchObject([
      { id: paired.environment.id, name: 'Windows 2' }
    ])
    expect(settings.activeRuntimeEnvironmentId).toBeNull()
    expect(globals.window.api.settings.getSync()?.activeRuntimeEnvironmentId).toBeNull()
    expect(JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}')).not.toHaveProperty(
      'activeRuntimeEnvironmentId'
    )
    await expect(
      globals.window.api.runtimeEnvironments.remove({ selector: paired.environment.id })
    ).resolves.toMatchObject({ removed: { id: paired.environment.id } })
    await expect(globals.window.api.runtimeEnvironments.list()).resolves.toEqual([])
  })

  it('stores paired device identity from a web access link', async () => {
    const globals = installBrowserGlobals('Linux')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const paired = await globals.window.api.runtimeEnvironments.addFromPairingCode({
      name: 'Shared server',
      pairingCode: encodePairingCode({ pairedDeviceId: 'paired-device-a' })
    })

    expect(paired.environment.pairedDeviceId).toBe('paired-device-a')
    expect(
      JSON.parse(globals.storage.getItem('orca.web.runtimeEnvironment.v1') ?? '{}')
    ).toMatchObject({ pairedDeviceId: 'paired-device-a' })
  })

  it('persists an explicit Active Server choice across unrelated web settings writes', async () => {
    const globals = installBrowserGlobals('Linux')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    const paired = await globals.window.api.runtimeEnvironments.addFromPairingCode({
      name: 'Windows 2',
      pairingCode: encodePairingCode({ publicKeyB64: 'windows-2-key' })
    })

    await globals.window.api.settings.setActiveRuntimeEnvironmentPreference({
      environmentId: 'Windows 2'
    })
    await globals.window.api.settings.set({ terminalFontSize: 15 })
    expect(JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}')).toMatchObject({
      activeRuntimeEnvironmentId: paired.environment.id,
      terminalFontSize: 15
    })

    await globals.window.api.settings.setActiveRuntimeEnvironmentPreference({
      environmentId: null
    })
    await globals.window.api.settings.set({ terminalFontSize: 16 })
    expect(JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}')).toMatchObject({
      activeRuntimeEnvironmentId: null,
      terminalFontSize: 16
    })
  })

  it('rejects an unknown explicit Active Server choice without corrupting the preference', async () => {
    const globals = installBrowserGlobals('Linux')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    const paired = await globals.window.api.runtimeEnvironments.addFromPairingCode({
      name: 'Windows 2',
      pairingCode: encodePairingCode({ publicKeyB64: 'windows-2-key' })
    })
    await globals.window.api.settings.setActiveRuntimeEnvironmentPreference({
      environmentId: paired.environment.id
    })

    await expect(
      globals.window.api.settings.setActiveRuntimeEnvironmentPreference({
        environmentId: 'unknown-server'
      })
    ).rejects.toThrow(`Unknown ${APP_DISPLAY_NAME} runtime environment: unknown-server`)
    expect(JSON.parse(globals.storage.getItem('orca.web.settings.v1') ?? '{}')).toMatchObject({
      activeRuntimeEnvironmentId: paired.environment.id
    })
  })

  it('keeps old selectors only when re-pairing proves the same server key', async () => {
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const paired = await globals.window.api.runtimeEnvironments.addFromPairingCode({
      name: 'Server A again',
      pairingCode: encodePairingCode({ publicKeyB64: 'public-key' })
    })

    await expect(
      globals.window.api.runtimeEnvironments.resolve({ selector: 'web-server-a' })
    ).resolves.toMatchObject({ id: paired.environment.id, name: 'Server A again' })
  })

  it('ignores malformed persisted compatibility ids when resolving selectors', async () => {
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
    const stored = JSON.parse(
      globals.storage.getItem('orca.web.runtimeEnvironment.v1') ?? '{}'
    ) as Record<string, unknown>
    stored.compatibleEnvironmentIds = { old: 'web-server-old' }
    globals.storage.setItem('orca.web.runtimeEnvironment.v1', JSON.stringify(stored))
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    await expect(
      globals.window.api.runtimeEnvironments.resolve({ selector: 'web-server-old' })
    ).rejects.toThrow(`Unknown ${APP_DISPLAY_NAME} runtime environment: web-server-old`)
  })

  it('ignores malformed persisted paired device identity', async () => {
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const stored = JSON.parse(
      globals.storage.getItem('orca.web.runtimeEnvironment.v1') ?? '{}'
    ) as Record<string, unknown>
    stored.pairedDeviceId = { invalid: true }
    globals.storage.setItem('orca.web.runtimeEnvironment.v1', JSON.stringify(stored))
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const [environment] = await globals.window.api.runtimeEnvironments.list()
    expect(environment).not.toHaveProperty('pairedDeviceId')
  })

  it('keeps pairing while manual disconnect fences passive reconnects', async () => {
    const calls: string[] = []
    const close = vi.fn()
    let clientCount = 0
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        constructor() {
          clientCount += 1
        }

        call(method: string): Promise<RuntimeRpcResponse<unknown>> {
          calls.push(method)
          return Promise.resolve({
            id: method,
            ok: true,
            result: { runtimeId: 'runtime-1', pairedDeviceId: 'paired-device-a' },
            _meta: { runtimeId: 'runtime-1' }
          })
        }

        close(): void {
          close()
        }
      }
    }))
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    await expect(
      globals.window.api.runtimeEnvironments.getStatus({ selector: 'web-server-a' })
    ).resolves.toMatchObject({ ok: true })
    await globals.window.api.runtimeEnvironments.disconnect({ selector: 'web-server-a' })

    await expect(globals.window.api.runtimeEnvironments.list()).resolves.toMatchObject([
      { id: 'web-server-a' }
    ])
    await expect(
      globals.window.api.runtimeEnvironments.getStatus({ selector: 'web-server-a' })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'runtime_manually_disconnected' }
    })
    await expect(
      globals.window.api.runtimeEnvironments.call({
        selector: 'web-server-a',
        method: 'repos.list'
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'runtime_manually_disconnected' }
    })
    await expect(
      globals.window.api.runtimeEnvironments.subscribe(
        { selector: 'web-server-a', method: 'terminal.subscribe' },
        { onResponse: vi.fn() }
      )
    ).rejects.toThrow('runtime_manually_disconnected')
    expect(clientCount).toBe(1)
    expect(calls).toEqual(['status.get'])
    expect(close).toHaveBeenCalledOnce()

    await expect(
      globals.window.api.runtimeEnvironments.connect({ selector: 'web-server-a' })
    ).resolves.toMatchObject({ ok: true })
    expect(clientCount).toBe(2)
    expect(calls).toEqual(['status.get', 'status.get'])
    expect(
      JSON.parse(globals.storage.getItem('orca.web.runtimeEnvironment.v1') ?? '{}')
    ).toMatchObject({ pairedDeviceId: 'paired-device-a' })
  })

  it('fences a web runtime response that completes after manual disconnect', async () => {
    let resolveCall!: (response: RuntimeRpcResponse<unknown>) => void
    const pendingCall = new Promise<RuntimeRpcResponse<unknown>>((resolve) => {
      resolveCall = resolve
    })
    const call = vi.fn(() => pendingCall)
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call = call
        close(): void {}
      }
    }))
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    const status = globals.window.api.runtimeEnvironments.getStatus({
      selector: 'web-server-a'
    })
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce())
    await globals.window.api.runtimeEnvironments.disconnect({ selector: 'web-server-a' })
    resolveCall({
      id: 'status.get',
      ok: true,
      result: { runtimeId: 'runtime-1' },
      _meta: { runtimeId: 'runtime-1' }
    })

    await expect(status).resolves.toMatchObject({
      ok: false,
      error: { code: 'runtime_manually_disconnected' }
    })
  })

  it.each(['active runtime', 'selected environment'] as const)(
    'returns a disconnect envelope when a queued %s call disconnects',
    async (route) => {
      const pending: ((response: RuntimeRpcResponse<unknown>) => void)[] = []
      const call = vi.fn(
        (method: string) =>
          new Promise<RuntimeRpcResponse<unknown>>((resolve) => {
            pending.push((response) => resolve({ ...response, id: method }))
          })
      )
      vi.doMock('./web-runtime-client', () => ({
        WebRuntimeClient: class {
          call = call
          close(): void {}
        }
      }))
      const globals = installBrowserGlobals('Linux')
      writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
      const { installWebPreloadApi } = await import('./web-preload-api')
      installWebPreloadApi()
      const invoke = (): Promise<RuntimeRpcResponse<unknown>> =>
        route === 'active runtime'
          ? globals.window.api.runtime.call({ method: 'repos.list' })
          : globals.window.api.runtimeEnvironments.call({
              selector: 'web-server-a',
              method: 'repos.list'
            })

      const activeCalls = Array.from({ length: 8 }, invoke)
      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(8))
      const queuedCall = invoke()
      expect(call).toHaveBeenCalledTimes(8)

      await globals.window.api.runtimeEnvironments.disconnect({ selector: 'web-server-a' })
      pending[0]?.({
        id: 'repos.list',
        ok: true,
        result: {},
        _meta: { runtimeId: 'runtime-1' }
      })

      await expect(queuedCall).resolves.toMatchObject({
        ok: false,
        error: { code: 'runtime_manually_disconnected' }
      })
      expect(call).toHaveBeenCalledTimes(8)

      for (const resolve of pending.slice(1)) {
        resolve({
          id: 'repos.list',
          ok: true,
          result: {},
          _meta: { runtimeId: 'runtime-1' }
        })
      }
      await expect(Promise.all(activeCalls)).resolves.toEqual(
        Array.from({ length: 8 }, () =>
          expect.objectContaining({
            ok: false,
            error: expect.objectContaining({ code: 'runtime_manually_disconnected' })
          })
        )
      )
    }
  )
  it('keeps the current host when verification rejects an incompatible replacement', async () => {
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(): Promise<RuntimeRpcResponse<unknown>> {
          return Promise.resolve({
            id: 'status',
            ok: true,
            result: { runtimeProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION - 1 },
            _meta: { runtimeId: 'runtime-old' }
          })
        }

        close(): void {}
      }
    }))
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
    const previousStored = globals.storage.getItem('orca.web.runtimeEnvironment.v1')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    await expect(
      globals.window.api.runtimeEnvironments.verifyAndAddFromPairingCode({
        name: 'Incompatible server',
        pairingCode: encodePairingCode()
      })
    ).resolves.toMatchObject({ ok: false, kind: 'protocol-incompatible' })
    expect(globals.storage.getItem('orca.web.runtimeEnvironment.v1')).toBe(previousStored)
    await expect(globals.window.api.runtimeEnvironments.list()).resolves.toMatchObject([
      { id: 'web-server-a' }
    ])
  })

  it('keeps the current host when browser storage rejects a verified replacement', async () => {
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(): Promise<RuntimeRpcResponse<unknown>> {
          return Promise.resolve({
            id: 'status',
            ok: true,
            result: {
              runtimeId: 'runtime-new',
              rendererGraphEpoch: 1,
              graphStatus: 'ready',
              authoritativeWindowId: 1,
              liveTabCount: 0,
              liveLeafCount: 0,
              runtimeProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION
            },
            _meta: { runtimeId: 'runtime-new' }
          })
        }

        close(): void {}
      }
    }))
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    vi.spyOn(globals.storage, 'setItem').mockImplementation(() => {
      throw new Error('Browser storage is full.')
    })

    await expect(
      globals.window.api.runtimeEnvironments.verifyAndAddFromPairingCode({
        name: 'Verified replacement',
        pairingCode: encodePairingCode()
      })
    ).resolves.toMatchObject({
      ok: false,
      kind: 'environment-save-failed',
      message: `${APP_DISPLAY_NAME} verified the host but could not save it. Check browser storage and try again.`
    })
    await expect(globals.window.api.runtimeEnvironments.list()).resolves.toMatchObject([
      { id: 'web-server-a' }
    ])
  })

  it('requires an explicit loopback override and persists the SSH dependency', async () => {
    const call = vi.fn().mockResolvedValue({
      id: 'status',
      ok: true,
      result: {
        runtimeId: 'runtime-new',
        rendererGraphEpoch: 1,
        graphStatus: 'ready',
        authoritativeWindowId: 1,
        liveTabCount: 0,
        liveLeafCount: 0,
        runtimeProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION
      },
      _meta: { runtimeId: 'runtime-new' }
    })
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call = call
        close(): void {}
      }
    }))
    const globals = installBrowserGlobals('Linux')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    const pairingCode = encodePairingCode({ endpoint: 'ws://127.0.0.1:6768' })

    await expect(
      globals.window.api.runtimeEnvironments.verifyAndAddFromPairingCode({
        name: 'Tunnel server',
        pairingCode
      })
    ).resolves.toMatchObject({ ok: false, kind: 'host-unreachable' })
    expect(call).not.toHaveBeenCalled()

    await expect(
      globals.window.api.runtimeEnvironments.verifyAndAddFromPairingCode({
        name: 'Tunnel server',
        pairingCode,
        allowLoopback: true
      })
    ).resolves.toMatchObject({
      ok: true,
      environment: { connectionDependency: 'ssh-tunnel' }
    })
    expect(call).toHaveBeenCalledOnce()
    expect(
      JSON.parse(globals.storage.getItem('orca.web.runtimeEnvironment.v1') ?? '{}')
    ).toMatchObject({ connectionDependency: 'ssh-tunnel' })
  })

  it('returns a structured failure when the browser client cannot be constructed', async () => {
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        constructor() {
          throw new Error('Invalid public key: expected 32 bytes, got 3')
        }
      }
    }))
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    await expect(
      globals.window.api.runtimeEnvironments.verifyAndAddFromPairingCode({
        name: 'Broken server',
        pairingCode: encodePairingCode()
      })
    ).resolves.toMatchObject({ ok: false, kind: 'access-link-invalid' })
    await expect(globals.window.api.runtimeEnvironments.list()).resolves.toMatchObject([
      { id: 'web-server-a' }
    ])
  })

  it('classifies coded browser authorization failures without relying on copy', async () => {
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(): Promise<RuntimeRpcResponse<unknown>> {
          return Promise.reject(
            Object.assign(new Error('Access grant rejected.'), { code: 'unauthorized' })
          )
        }

        close(): void {}
      }
    }))
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    await expect(
      globals.window.api.runtimeEnvironments.verifyAndAddFromPairingCode({
        name: 'Expired server',
        pairingCode: encodePairingCode()
      })
    ).resolves.toMatchObject({
      ok: false,
      kind: 'access-link-invalid',
      message: 'Access grant rejected.'
    })
  })

  it('replaces API closures on reinstall while retaining the runtime client singleton', async () => {
    let clientCount = 0
    const call = vi.fn((method: string): Promise<RuntimeRpcResponse<unknown>> =>
      Promise.resolve({
        id: method,
        ok: true,
        result: { method },
        _meta: { runtimeId: 'runtime-a' }
      })
    )
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        constructor() {
          clientCount += 1
        }

        call = call

        close(): void {}
      }
    }))
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    const firstApi = globals.window.api
    const initialZoom = firstApi.ui.getZoomLevel()
    firstApi.ui.setZoomLevel(initialZoom + 1)
    await expect(firstApi.runtime.call({ method: 'status.first' })).resolves.toEqual({
      id: 'status.first',
      ok: true,
      result: { method: 'status.first' },
      _meta: { runtimeId: 'runtime-a' }
    })
    expect(
      JSON.parse(globals.storage.getItem('orca.web.runtimeEnvironment.v1') ?? '{}')
    ).toMatchObject({ runtimeId: 'runtime-a' })

    installWebPreloadApi()
    const secondApi = globals.window.api
    await secondApi.runtime.call({ method: 'status.second' })
    await firstApi.runtime.call({ method: 'status.old-capture' })

    expect(secondApi).not.toBe(firstApi)
    expect(secondApi.ui.getZoomLevel()).toBe(initialZoom)
    expect(firstApi.ui.getZoomLevel()).toBe(initialZoom + 1)
    expect(clientCount).toBe(1)
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      'status.first',
      'status.second',
      'status.old-capture'
    ])
  })
})
