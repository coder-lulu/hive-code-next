import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPreflightHandlers } from '../ipc/preflight'
import { PREFLIGHT_METHODS } from '../runtime/rpc/methods/preflight'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { preflightApi } from '../../preload/api/preflight-bridge'

const { handle, invoke, readCurrent, readLatest, install } = vi.hoisted(() => ({
  handle: vi.fn(),
  invoke: vi.fn(),
  readCurrent: vi.fn(),
  readLatest: vi.fn(),
  install: vi.fn()
}))
const inventory = vi.hoisted(() => vi.fn())
vi.mock('./agent-installations-service', () => ({ readAgentInstallations: inventory }))

vi.mock('electron', () => ({ ipcMain: { handle }, ipcRenderer: { invoke } }))
vi.mock('./agent-install-service', () => ({ installAgent: install }))
vi.mock('./agent-version-service', () => ({
  readAgentVersion: readCurrent,
  readLatestAgentVersion: readLatest
}))
vi.mock('./agent-detection', () => ({
  detectInstalledAgentsWithShellPathHydration: vi.fn(),
  detectRemoteAgents: vi.fn(),
  detectRemoteWindowsTerminalCapabilities: vi.fn(),
  refreshShellPathAndDetectAgents: vi.fn(),
  runPreflightCheck: vi.fn()
}))

describe('agent version controlled boundaries', () => {
  it('routes inventory through both validated boundaries and the typed preload bridge', async () => {
    inventory.mockResolvedValue({
      status: 'ready',
      installations: [],
      conflict: false,
      truncated: false
    })
    const args = { agent: 'codex' as const, wslDistro: 'Ubuntu' }
    await preflightApi.readAgentInstallations(args)
    expect(invoke).toHaveBeenCalledWith('preflight:readAgentInstallations', args)
    registerPreflightHandlers()
    const handlers = Object.fromEntries(handle.mock.calls)
    await expect(handlers['preflight:readAgentInstallations']({}, args)).resolves.toMatchObject({
      status: 'ready'
    })
    await expect(
      handlers['preflight:readAgentInstallations']({}, { ...args, sourceUrl: 'https://invalid' })
    ).rejects.toThrow()
    const response = await dispatcher().dispatch({
      id: 'inventory',
      authToken: 'token',
      method: 'preflight.readAgentInstallations',
      params: args
    })
    expect(response).toMatchObject({ ok: true, result: { status: 'ready' } })
    expect(inventory).toHaveBeenCalledWith(args)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    readCurrent.mockResolvedValue({ status: 'ready', version: '0.106.0' })
    readLatest.mockResolvedValue({ status: 'ready', version: '0.107.0', channel: 'npm-latest' })
    install.mockResolvedValue({ status: 'installed', version: '0.107.0' })
  })

  function dispatcher(): RpcDispatcher {
    return new RpcDispatcher({
      runtime: { getRuntimeId: () => 'executing-runtime' } as unknown as OrcaRuntimeService,
      methods: PREFLIGHT_METHODS
    })
  }

  it('routes installation through validated IPC, preload and executing Runtime boundaries', async () => {
    const args = { agent: 'codex' as const, wslDistro: 'Ubuntu' }
    await preflightApi.installAgent(args)
    expect(invoke).toHaveBeenCalledWith('preflight:installAgent', args)
    registerPreflightHandlers()
    const handlers = Object.fromEntries(handle.mock.calls)
    await expect(handlers['preflight:installAgent']({}, args)).resolves.toMatchObject({
      status: 'installed'
    })
    const result = await dispatcher().dispatch({
      id: 'install-1',
      authToken: 'token',
      method: 'preflight.installAgent',
      params: args
    })
    expect(result).toMatchObject({
      ok: true,
      result: { status: 'installed' },
      _meta: { runtimeId: 'executing-runtime' }
    })
    expect(install).toHaveBeenCalledTimes(2)
    const invalid = await dispatcher().dispatch({
      id: 'install-2',
      authToken: 'token',
      method: 'preflight.installAgent',
      params: { ...args, command: 'npm install malicious' }
    })
    expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(
      handlers['preflight:installAgent']({}, { ...args, packageName: 'malicious' })
    ).rejects.toThrow()
    expect(install).toHaveBeenCalledTimes(2)
  })

  it('reads the version on the invoked Runtime host with exact validated target arguments', async () => {
    const args = { agent: 'codex', commandOverride: '/opt/codex', wslDistro: 'Ubuntu' }
    const response = await dispatcher().dispatch({
      id: 'version-1',
      authToken: 'token',
      method: 'preflight.readAgentVersion',
      params: args
    })
    expect(response).toMatchObject({
      ok: true,
      result: { status: 'ready', version: '0.106.0' },
      _meta: { runtimeId: 'executing-runtime' }
    })
    expect(readCurrent).toHaveBeenCalledWith(args)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('queries upstream on the same invoked Runtime without a client-local fallback', async () => {
    const response = await dispatcher().dispatch({
      id: 'version-2',
      authToken: 'token',
      method: 'preflight.readLatestAgentVersion',
      params: { agent: 'codex' }
    })
    expect(response).toMatchObject({
      ok: true,
      result: { version: '0.107.0', channel: 'npm-latest' }
    })
    expect(readLatest).toHaveBeenCalledWith({ agent: 'codex' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([
    { agent: 'unknown-agent' },
    { agent: 'codex', wslDistro: '' },
    { agent: 'codex', environmentId: 'spoofed-host' },
    { agent: 'codex', commandOverride: 'x'.repeat(4097) }
  ])('rejects invalid current-version RPC input before reaching execution', async (params) => {
    const response = await dispatcher().dispatch({
      id: 'version-invalid',
      authToken: 'token',
      method: 'preflight.readAgentVersion',
      params
    })
    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(readCurrent).not.toHaveBeenCalled()
  })

  it('rejects caller-supplied upstream URLs', async () => {
    const response = await dispatcher().dispatch({
      id: 'latest-invalid',
      authToken: 'token',
      method: 'preflight.readLatestAgentVersion',
      params: { agent: 'codex', sourceUrl: 'https://untrusted.example/' }
    })
    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(readLatest).not.toHaveBeenCalled()
  })

  it('validates native IPC arguments before invoking the same services', async () => {
    registerPreflightHandlers()
    const handlers: Record<string, (event: unknown, args: unknown) => Promise<unknown>> =
      Object.fromEntries(handle.mock.calls)
    const current = handlers['preflight:readAgentVersion']
    const latest = handlers['preflight:readLatestAgentVersion']
    expect(typeof current).toBe('function')
    expect(typeof latest).toBe('function')
    await expect(current({}, { agent: 'codex', wslDistro: 'Ubuntu' })).resolves.toMatchObject({
      status: 'ready'
    })
    await expect(latest({}, { agent: 'codex' })).resolves.toMatchObject({ channel: 'npm-latest' })
    await expect(current({}, { agent: 'unknown' })).rejects.toThrow()
    await expect(
      latest({}, { agent: 'codex', sourceUrl: 'https://untrusted.example/' })
    ).rejects.toThrow()
    expect(readCurrent).toHaveBeenCalledTimes(1)
    expect(readLatest).toHaveBeenCalledTimes(1)
  })

  it('exposes exact typed preload calls without running commands in the Renderer', async () => {
    const args = { agent: 'codex' as const, commandOverride: 'codex', wslDistro: 'Ubuntu' }
    await preflightApi.readAgentVersion(args)
    await preflightApi.readLatestAgentVersion({ agent: 'codex' })
    expect(invoke.mock.calls).toEqual([
      ['preflight:readAgentVersion', args],
      ['preflight:readLatestAgentVersion', { agent: 'codex' }]
    ])
    expect(readCurrent).not.toHaveBeenCalled()
    expect(readLatest).not.toHaveBeenCalled()
  })
})
