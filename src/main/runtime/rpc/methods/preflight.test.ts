import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { PREFLIGHT_METHODS } from './preflight'

const {
  detectInstalledAgentsWithShellPathHydrationMock,
  detectRemoteAgentsMock,
  detectRemoteWindowsTerminalCapabilitiesMock,
  refreshShellPathAndDetectAgentsMock,
  runPreflightCheckMock,
  installAgentMock,
  latestVersionMock
} = vi.hoisted(() => ({
  detectInstalledAgentsWithShellPathHydrationMock: vi.fn(),
  detectRemoteAgentsMock: vi.fn(),
  detectRemoteWindowsTerminalCapabilitiesMock: vi.fn(),
  refreshShellPathAndDetectAgentsMock: vi.fn(),
  runPreflightCheckMock: vi.fn(),
  installAgentMock: vi.fn(),
  latestVersionMock: vi.fn()
}))

vi.mock('../../../preflight/agent-install-service', () => ({ installAgent: installAgentMock }))
vi.mock('../../../preflight/agent-version-service', () => ({
  readAgentVersion: vi.fn(),
  readLatestAgentVersion: latestVersionMock
}))

vi.mock('../../../preflight/agent-detection', () => ({
  detectInstalledAgentsWithShellPathHydration: detectInstalledAgentsWithShellPathHydrationMock,
  detectRemoteAgents: detectRemoteAgentsMock,
  detectRemoteWindowsTerminalCapabilities: detectRemoteWindowsTerminalCapabilitiesMock,
  refreshShellPathAndDetectAgents: refreshShellPathAndDetectAgentsMock,
  runPreflightCheck: runPreflightCheckMock
}))

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('preflight RPC methods', () => {
  it('forwards upgrade action, selected source and exact WSL command to the executing runtime', async () => {
    const params = {
      agent: 'grok',
      action: 'upgrade',
      registry: 'china',
      wslDistro: 'Ubuntu',
      commandOverride: '/home/user/bin/grok'
    }
    installAgentMock.mockResolvedValueOnce({
      status: 'installed',
      version: '2.0.0',
      previousVersion: '1.0.0'
    })
    const dispatcher = new RpcDispatcher({
      runtime: { getRuntimeId: () => 'test-runtime' } as unknown as OrcaRuntimeService,
      methods: PREFLIGHT_METHODS
    })
    expect(await dispatcher.dispatch(makeRequest('preflight.installAgent', params))).toMatchObject({
      ok: true,
      result: { status: 'installed', version: '2.0.0' }
    })
    expect(installAgentMock).toHaveBeenLastCalledWith(params)
  })

  it('rejects arbitrary registry URLs without starting an installation', async () => {
    const before = installAgentMock.mock.calls.length
    const dispatcher = new RpcDispatcher({
      runtime: { getRuntimeId: () => 'test-runtime' } as unknown as OrcaRuntimeService,
      methods: PREFLIGHT_METHODS
    })
    expect(
      await dispatcher.dispatch(
        makeRequest('preflight.installAgent', {
          agent: 'codex',
          registry: 'https://untrusted.invalid'
        })
      )
    ).toMatchObject({ ok: false })
    expect(installAgentMock.mock.calls).toHaveLength(before)
  })

  it('forwards the selected latest-version source to the runtime', async () => {
    latestVersionMock.mockResolvedValueOnce({
      status: 'ready',
      version: '1.2.3',
      channel: 'npm-latest'
    })
    const dispatcher = new RpcDispatcher({
      runtime: { getRuntimeId: () => 'test-runtime' } as unknown as OrcaRuntimeService,
      methods: PREFLIGHT_METHODS
    })
    expect(
      await dispatcher.dispatch(
        makeRequest('preflight.readLatestAgentVersion', { agent: 'grok', registry: 'china' })
      )
    ).toMatchObject({ ok: true, result: { version: '1.2.3' } })
    expect(latestVersionMock).toHaveBeenLastCalledWith({ agent: 'grok', registry: 'china' })
  })
  it('runs the server-side preflight check through runtime RPC', async () => {
    const status = {
      git: { installed: true },
      gh: { installed: true, authenticated: true },
      glab: { installed: false, authenticated: false },
      bitbucket: { configured: false, authenticated: false, account: null }
    }
    runPreflightCheckMock.mockResolvedValueOnce(status)
    const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PREFLIGHT_METHODS })

    const response = await dispatcher.dispatch(makeRequest('preflight.check', { force: true }))

    expect(runPreflightCheckMock).toHaveBeenCalledWith(true)
    expect(response).toMatchObject({ ok: true, result: status })
  })

  it('detects agents and refreshes PATH on the server through runtime RPC', async () => {
    detectInstalledAgentsWithShellPathHydrationMock.mockResolvedValueOnce(['codex'])
    refreshShellPathAndDetectAgentsMock.mockResolvedValueOnce({
      agents: ['codex', 'claude'],
      addedPathSegments: ['/opt/bin'],
      shellHydrationOk: true,
      pathSource: 'shell_hydrate',
      pathFailureReason: 'none'
    })
    const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PREFLIGHT_METHODS })

    const detected = await dispatcher.dispatch(makeRequest('preflight.detectAgents'))
    const refreshed = await dispatcher.dispatch(makeRequest('preflight.refreshAgents'))

    expect(detectInstalledAgentsWithShellPathHydrationMock).toHaveBeenCalled()
    expect(refreshShellPathAndDetectAgentsMock).toHaveBeenCalled()
    expect(detected).toMatchObject({ ok: true, result: ['codex', 'hivecode'] })
    expect(refreshed).toMatchObject({
      ok: true,
      result: { agents: ['codex', 'claude', 'hivecode'], shellHydrationOk: true }
    })
  })

  it('detects agents on remote SSH connections through runtime RPC', async () => {
    detectRemoteAgentsMock.mockResolvedValueOnce(['claude'])
    const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PREFLIGHT_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('preflight.detectRemoteAgents', { connectionId: 'ssh-1' })
    )

    expect(detectRemoteAgentsMock).toHaveBeenCalledWith({ connectionId: 'ssh-1' })
    expect(response).toMatchObject({ ok: true, result: ['claude'] })
  })

  it('detects remote Windows terminal capabilities through runtime RPC', async () => {
    detectRemoteWindowsTerminalCapabilitiesMock.mockResolvedValueOnce({
      wslAvailable: true,
      wslDistros: ['Ubuntu'],
      pwshAvailable: true,
      gitBashAvailable: true,
      hostPlatform: 'win32'
    })
    const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PREFLIGHT_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('preflight.detectRemoteWindowsTerminalCapabilities', {
        connectionId: 'ssh-1'
      })
    )

    expect(detectRemoteWindowsTerminalCapabilitiesMock).toHaveBeenCalledWith({
      connectionId: 'ssh-1'
    })
    expect(response).toMatchObject({
      ok: true,
      result: {
        wslAvailable: true,
        wslDistros: ['Ubuntu'],
        pwshAvailable: true,
        gitBashAvailable: true,
        hostPlatform: 'win32'
      }
    })
  })
})
