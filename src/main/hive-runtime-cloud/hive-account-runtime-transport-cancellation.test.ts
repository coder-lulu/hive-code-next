import { afterEach, describe, expect, it, vi } from 'vitest'
import { HiveAccountRuntimeTransport } from './hive-account-runtime-transport'
import { HiveAccountRelayPool } from '../../shared/hive-account-relay-pool'
import { EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY } from '../../shared/hive-runtime-cloud'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import type { RuntimeEnvironmentAccountClaim } from '../../shared/runtime-environments'

const claim: RuntimeEnvironmentAccountClaim = {
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
const transports: HiveAccountRuntimeTransport[] = []
function setup() {
  const directory = {
    getState: () => EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
    getConnectionScope: () => 'account-session',
    createConnection: vi.fn(),
    subscribe: (listener: (state: typeof EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY) => void) => {
      listener({
        ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
        status: 'READY',
        accountId: 'account',
        sessionGeneration: 1
      })
      return vi.fn()
    }
  }
  const transport = new HiveAccountRuntimeTransport(directory, vi.fn())
  transports.push(transport)
  return transport
}
afterEach(() => {
  for (const transport of transports.splice(0)) {
    transport.stop()
  }
  vi.restoreAllMocks()
})

describe('account transport status and subscription boundaries', () => {
  it.each(['unauthorized', 'remote_runtime_upgrade_required', 'runtime_timeout'])(
    'preserves %s status failure details',
    async (code) => {
      const error = new RemoteRuntimeClientError(code, 'Action required', {
        data: { reason: 'test' }
      })
      vi.spyOn(HiveAccountRelayPool.prototype, 'request').mockRejectedValue(error)
      expect(await setup().getStatus(claim)).toMatchObject({
        ok: false,
        error: { code, message: error.message, data: error.data }
      })
    }
  )

  it('passes the status signal and preserves cancellation', async () => {
    const controller = new AbortController()
    const request = vi
      .spyOn(HiveAccountRelayPool.prototype, 'request')
      .mockImplementation(async () => {
        controller.abort()
        throw controller.signal.reason
      })
    await expect(setup().getStatus(claim, 1000, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(request).toHaveBeenCalledWith('status.get', {}, 1000, undefined, controller.signal)
  })

  it('does not acquire a pool subscription for an already aborted signal', async () => {
    const subscribe = vi
      .spyOn(HiveAccountRelayPool.prototype, 'subscribe')
      .mockRejectedValue(new Error('must not run'))
    const controller = new AbortController()
    controller.abort()
    await expect(
      setup().subscribe(
        claim,
        'terminal.multiplex',
        {},
        1000,
        { onResponse: vi.fn(), onError: vi.fn(), onClose: vi.fn() },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('forwards subscription cancellation without normalizing it to a connection failure', async () => {
    const controller = new AbortController()
    const subscribe = vi
      .spyOn(HiveAccountRelayPool.prototype, 'subscribe')
      .mockImplementation(async () => {
        controller.abort()
        throw controller.signal.reason
      })
    const callbacks = { onResponse: vi.fn(), onError: vi.fn(), onClose: vi.fn() }
    await expect(
      setup().subscribe(claim, 'terminal.multiplex', {}, 1000, callbacks, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(subscribe).toHaveBeenCalledWith(
      'terminal.multiplex',
      {},
      callbacks,
      1000,
      controller.signal
    )
  })
})
