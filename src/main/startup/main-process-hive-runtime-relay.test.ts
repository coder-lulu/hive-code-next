import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(async () => {}),
  construct: vi.fn()
}))
vi.mock('../hive-runtime-cloud/relay-host/hive-runtime-relay-host-service', () => ({
  HiveRuntimeRelayHostService: class {
    constructor(options: unknown) {
      mocks.construct(options)
    }
    start = mocks.start
    stop = mocks.stop
  }
}))
import {
  hiveRelayV2HostEnabled,
  installHiveRuntimeRelay,
  stopHiveRuntimeRelay
} from './main-process-hive-runtime-relay'
import type { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud/hive-runtime-cloud-presence-service'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
afterEach(async () => {
  await stopHiveRuntimeRelay()
  vi.clearAllMocks()
})

it('keeps the single product policy default false and installs the shared host once when enabled', async () => {
  const presence = {} as HiveRuntimeCloudPresenceService
  const getE2EEKeypair = vi.fn(() => null)
  const attachAccountRuntimeConnection = vi.fn()
  const rpc = { getE2EEKeypair, attachAccountRuntimeConnection } as unknown as OrcaRuntimeRpcServer
  const config = { enabled: true as const, apiBaseUrl: 'https://api.hivekernel.com' }
  expect(hiveRelayV2HostEnabled({})).toBe(false)
  installHiveRuntimeRelay(config, presence, rpc, '/data', {})
  expect(mocks.construct).not.toHaveBeenCalled()
  expect(() =>
    installHiveRuntimeRelay(config, presence, rpc, '/data', { HIVE_RELAY_V2_HOST_ENABLED: '1' })
  ).toThrow('region_invalid')
  const env = { HIVE_RELAY_V2_HOST_ENABLED: '1', HIVE_RELAY_REGION: 'cn-shanghai' }
  installHiveRuntimeRelay(config, presence, rpc, '/data', env)
  installHiveRuntimeRelay(config, presence, rpc, '/data', env)
  expect(mocks.start).toHaveBeenCalledTimes(1)
  const options = mocks.construct.mock.calls[0][0]
  options.getKeypair()
  options.attachRpc('connection')
  expect(getE2EEKeypair).toHaveBeenCalledOnce()
  expect(attachAccountRuntimeConnection).toHaveBeenCalledWith('connection')
  await stopHiveRuntimeRelay()
  expect(mocks.stop).toHaveBeenCalledOnce()
})
