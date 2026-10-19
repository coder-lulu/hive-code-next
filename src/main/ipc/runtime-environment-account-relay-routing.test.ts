import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicKnownRuntimeEnvironment } from '../../shared/runtime-environments'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'

const mocks = vi.hoisted(() => ({
  directStatus: vi.fn(),
  directCall: vi.fn(),
  directSubscribe: vi.fn(),
  relayStatus: vi.fn(),
  relayCall: vi.fn(),
  relaySubscribe: vi.fn(),
  access: vi.fn()
}))
vi.mock('./runtime-environment-transport-routing', () => ({
  getRuntimeEnvironmentStatus: mocks.directStatus,
  callRuntimeEnvironment: mocks.directCall,
  subscribeRuntimeEnvironment: mocks.directSubscribe
}))
vi.mock('../hive-runtime-cloud/hive-account-runtime-access', () => ({
  getHiveAccountRuntimeAccess: mocks.access
}))
import {
  callCatalogEnvironment as call,
  getCatalogEnvironmentStatus as status,
  subscribeCatalogEnvironment as subscribe
} from './runtime-environment-account-routing'

const response = { id: 'request', ok: true, result: {}, _meta: { runtimeId: 'runtime' } }
const subscription = { requestId: 'subscription', close: vi.fn(), sendBinary: vi.fn() }
const callbacks = { onEvent: vi.fn(), onClose: vi.fn() }
const claim: NonNullable<PublicKnownRuntimeEnvironment['accountClaim']> = {
  runtimeRecordId: 'record',
  resourceVersion: 1,
  ownershipEpoch: 1,
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: null,
  lastHeartbeatAt: 1,
  freeDiskBytes: null,
  clientAuthMode: 'IDENTITY_PROOF',
  credentialState: 'ACTIVE',
  connectionCapabilities: ['hive-relay'],
  cloudConnectable: true,
  cloudDisplayName: null,
  cloudDisplayNameVersion: 1
}
function environment(cloudOnly = false): PublicKnownRuntimeEnvironment {
  return {
    id: 'paired-host',
    name: 'Home PC',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    runtimeId: 'runtime',
    runtimeRecordId: 'record',
    accountClaim: claim,
    accessSources: cloudOnly ? ['account-claimed'] : ['local-pairing', 'account-claimed'],
    preferredEndpointId: 'vpn',
    endpoints: cloudOnly
      ? []
      : [
          {
            id: 'vpn',
            kind: 'websocket',
            label: 'Saved VPN',
            endpoint: 'ws://100.66.28.84:6768'
          }
        ]
  }
}
function expectNoDirect(): void {
  expect(mocks.directStatus).not.toHaveBeenCalled()
  expect(mocks.directCall).not.toHaveBeenCalled()
  expect(mocks.directSubscribe).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.access.mockReturnValue({
    transport: {
      getStatus: mocks.relayStatus,
      call: mocks.relayCall,
      subscribe: mocks.relaySubscribe
    }
  })
  mocks.relayStatus.mockResolvedValue(response)
  mocks.relayCall.mockResolvedValue(response)
  mocks.relaySubscribe.mockResolvedValue(subscription)
  mocks.directStatus.mockResolvedValue({ ok: false, error: { code: 'remote_runtime_unavailable' } })
  mocks.directCall.mockRejectedValue(new RemoteRuntimeClientError('runtime_timeout', 'VPN timeout'))
  mocks.directSubscribe.mockRejectedValue(
    new RemoteRuntimeClientError('runtime_timeout', 'VPN timeout')
  )
})

describe('account Relay route selection', () => {
  it.each([false, true])('uses Relay for status and files with cloudOnly=%s', async (cloudOnly) => {
    const env = environment(cloudOnly)
    const signal = new AbortController().signal
    expect(await status('userdata', env, 500)).toBe(response)
    expect(
      await call('userdata', env, 'files.readDir', { path: '/repo' }, 500, undefined, undefined, {
        signal
      })
    ).toBe(response)
    expect(mocks.relayStatus).toHaveBeenCalledWith(claim, 500, undefined)
    expect(mocks.relayCall).toHaveBeenCalledWith(
      claim,
      'files.readDir',
      { path: '/repo' },
      500,
      undefined,
      signal
    )
    expectNoDirect()
  })

  it.each(['terminal.multiplex', 'runtime.clientEvents.subscribe'])(
    'opens %s through Relay without testing the VPN endpoint',
    async (method) => {
      expect(await subscribe('userdata', environment(), method, {}, 500, callbacks)).toBe(
        subscription
      )
      expect(mocks.relaySubscribe).toHaveBeenCalledWith(
        claim,
        method,
        {},
        500,
        expect.any(Object),
        undefined
      )
      expectNoDirect()
    }
  )

  it.each(['runtime_unauthorized', 'runtime_timeout'])(
    'does not retry %s on a paired connection',
    async (code) => {
      const failure = new RemoteRuntimeClientError(code, 'Relay failed')
      const rejectedStatus = {
        id: 'status.get',
        ok: false,
        error: { code, message: failure.message },
        _meta: { runtimeId: 'runtime' }
      }
      mocks.relayStatus.mockResolvedValue(rejectedStatus)
      mocks.relayCall.mockRejectedValue(failure)
      mocks.relaySubscribe.mockRejectedValue(failure)
      expect(await status('userdata', environment())).toBe(rejectedStatus)
      await expect(call('userdata', environment(), 'files.readDir', {})).rejects.toBe(failure)
      await expect(
        subscribe('userdata', environment(), 'terminal.multiplex', {}, 500, callbacks)
      ).rejects.toBe(failure)
      expectNoDirect()
    }
  )

  it('reports unavailable account transport without dialing the VPN', async () => {
    mocks.access.mockReturnValue(null)
    expect(await status('userdata', environment())).toMatchObject({ ok: false })
    await expect(call('userdata', environment(), 'files.readDir', {})).rejects.toMatchObject({
      code: 'remote_runtime_unavailable'
    })
    await expect(
      subscribe('userdata', environment(), 'terminal.multiplex', {}, 500, callbacks)
    ).rejects.toMatchObject({ code: 'remote_runtime_unavailable' })
    expectNoDirect()
  })

  it.each(['paired', 'ssh', 'wsl'] as const)('preserves explicit %s routes', async (kind) => {
    const env = environment()
    if (kind === 'paired') {
      delete env.accountClaim
      env.accessSources = ['local-pairing']
    } else if (kind === 'ssh') {
      env.connectionDependency = 'ssh-tunnel'
    } else {
      env.orcadDeployment = { kind: 'wsl', distro: 'Ubuntu', localPort: 6768, remotePort: 6768 }
    }
    mocks.directStatus.mockResolvedValue(response)
    mocks.directCall.mockResolvedValue(response)
    mocks.directSubscribe.mockResolvedValue(subscription)
    expect(await status('userdata', env, 500)).toBe(response)
    expect(await call('userdata', env, 'files.readDir', {}, 500)).toBe(response)
    expect(await subscribe('userdata', env, 'terminal.multiplex', {}, 500, callbacks)).toBe(
      subscription
    )
    expect(mocks.directStatus).toHaveBeenCalledTimes(1)
    expect(mocks.directCall).toHaveBeenCalledTimes(1)
    expect(mocks.directSubscribe).toHaveBeenCalledTimes(1)
    expect(mocks.relayStatus).not.toHaveBeenCalled()
    expect(mocks.relayCall).not.toHaveBeenCalled()
    expect(mocks.relaySubscribe).not.toHaveBeenCalled()
  })

  it('forwards Relay events and preserves subscription cancellation', async () => {
    const result = await subscribe(
      'userdata',
      environment(true),
      'terminal.multiplex',
      {},
      500,
      callbacks
    )
    const relayCallbacks = mocks.relaySubscribe.mock.calls[0][4]
    const bytes = new Uint8Array([1, 2])
    relayCallbacks.onResponse(response)
    relayCallbacks.onBinary(bytes)
    relayCallbacks.onError({ code: 'runtime_timeout', message: 'lost' })
    relayCallbacks.onClose()
    expect(callbacks.onEvent.mock.calls).toEqual([
      [{ type: 'response', response }],
      [{ type: 'binary', bytes }],
      [{ type: 'error', code: 'runtime_timeout', message: 'lost' }],
      [{ type: 'close' }]
    ])
    expect(callbacks.onClose).toHaveBeenCalledOnce()
    result.close()
    expect(subscription.close).toHaveBeenCalledOnce()
  })

  it('passes status and subscription cancellation to the Relay transport', async () => {
    const signal = new AbortController().signal
    await status('userdata', environment(), 500, { signal })
    await subscribe(
      'userdata',
      environment(),
      'terminal.multiplex',
      {},
      500,
      callbacks,
      () => true,
      signal
    )
    expect(mocks.relayStatus).toHaveBeenCalledWith(claim, 500, signal)
    expect(mocks.relaySubscribe).toHaveBeenCalledWith(
      claim,
      'terminal.multiplex',
      {},
      500,
      expect.any(Object),
      signal
    )
    expectNoDirect()
  })

  it('does not open an aborted or invalidated account subscription', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      subscribe(
        'userdata',
        environment(),
        'terminal.multiplex',
        {},
        500,
        callbacks,
        () => true,
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(
      subscribe('userdata', environment(), 'terminal.multiplex', {}, 500, callbacks, () => false)
    ).rejects.toThrow('invalidated')
    expect(mocks.relaySubscribe).not.toHaveBeenCalled()
    expectNoDirect()
  })
})
