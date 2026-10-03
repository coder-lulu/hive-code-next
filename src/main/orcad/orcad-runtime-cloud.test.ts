import { readFileSync } from 'node:fs'
import { beforeEach, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud/hive-runtime-cloud-presence-service'
import type { HiveRuntimeRelayHostService } from '../hive-runtime-cloud/relay-host/hive-runtime-relay-host-service'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { getOrCreateHiveRuntimeCloudServiceIdentity } from '../hive-runtime-cloud/hive-runtime-cloud-identity-store'
import {
  readHiveRuntimeCloudServiceRegistrationState,
  saveHiveRuntimeCloudServiceRegistrationState
} from '../hive-runtime-cloud/hive-runtime-cloud-state-store'

const mock = vi.hoisted(() => ({
  presenceOptions: null as unknown as ConstructorParameters<typeof HiveRuntimeCloudPresenceService>,
  hostOptions: null as unknown as ConstructorParameters<typeof HiveRuntimeRelayHostService>[0],
  ready: vi.fn(),
  authorization: vi.fn(),
  stop: vi.fn(async () => {}),
  unsubscribe: vi.fn(),
  hostStart: vi.fn(),
  hostStop: vi.fn(async () => {})
}))
vi.mock('../hive-runtime-cloud/hive-runtime-cloud-presence-service', () => ({
  HiveRuntimeCloudPresenceService: class {
    constructor(...options: ConstructorParameters<typeof HiveRuntimeCloudPresenceService>) {
      mock.presenceOptions = options
    }
    subscribeState(listener: (state: string) => void) {
      listener('WAITING_RUNTIME')
      return mock.unsubscribe
    }
    getBootId() {
      return '10000000-0000-4000-8000-000000000001'
    }
    getState() {
      return 'SIGNED_OUT'
    }
    notifyRegistrationChanged = vi.fn()
    setAuthorization = mock.authorization
    setRuntimeReady = mock.ready
    stop = mock.stop
  }
}))
vi.mock('../hive-runtime-cloud/relay-host/hive-runtime-relay-host-service', () => ({
  HiveRuntimeRelayHostService: class {
    constructor(options: ConstructorParameters<typeof HiveRuntimeRelayHostService>[0]) {
      mock.hostOptions = options
    }
    start = mock.hostStart
    stop = mock.hostStop
  }
}))
import { createOrcadRuntimeCloud } from './orcad-runtime-cloud'
beforeEach(() => vi.clearAllMocks())

it('starts the existing Host only after RPC readiness and shares service-owned registration and local claim control', async () => {
  const cloud = createOrcadRuntimeCloud({
    userDataPath: '/unused',
    runtimeVersion: '1.0.0',
    runtime: { getStartedAt: () => 1, getStatus: () => ({ graphStatus: 'ready' }) },
    env: { HIVE_RELAY_REGION: 'cn-shanghai' }
  })
  expect(mock.ready).not.toHaveBeenCalled()
  expect(mock.hostStart).not.toHaveBeenCalled()
  expect(mock.presenceOptions[3]).toMatchObject({
    loadIdentity: getOrCreateHiveRuntimeCloudServiceIdentity,
    readState: readHiveRuntimeCloudServiceRegistrationState,
    saveState: saveHiveRuntimeCloudServiceRegistrationState
  })
  expect(cloud.ownership.beginHeadlessClaim).toBeTypeOf('function')
  expect(cloud.ownership.pollHeadlessClaim).toBeTypeOf('function')
  const rpc = {
    getE2EEKeypair: vi.fn(() => null),
    attachAccountRuntimeConnection: vi.fn()
  } as unknown as OrcaRuntimeRpcServer
  cloud.rpcReady(rpc)
  cloud.rpcReady(rpc)
  expect(mock.hostStart).toHaveBeenCalledOnce()
  expect(mock.hostOptions.requestedRegion).toBe('cn-shanghai')
  expect(mock.ready).toHaveBeenCalledExactlyOnceWith(true)
  const stopping = cloud.stop()
  expect(cloud.stop()).toBe(stopping)
  await stopping
  expect(mock.ready).toHaveBeenLastCalledWith(false)
  expect(mock.unsubscribe).toHaveBeenCalledOnce()
  expect(mock.stop).toHaveBeenCalledOnce()
  expect(mock.hostStop).toHaveBeenCalledOnce()
})

it('automatically starts Host with server-selected placement and wires local control before listening', async () => {
  const cloud = createOrcadRuntimeCloud({
    userDataPath: '/unused',
    runtimeVersion: '1.0.0',
    runtime: { getStartedAt: () => 1, getStatus: () => ({ graphStatus: 'ready' }) },
    env: {}
  })
  cloud.rpcReady({} as OrcaRuntimeRpcServer)
  expect(mock.hostStart).toHaveBeenCalledOnce()
  expect(mock.hostOptions.requestedRegion).toBeUndefined()
  await cloud.stop()
  const entry = readFileSync(new URL('./orcad-entry.ts', import.meta.url), 'utf8')
  expect(entry).toContain('hiveRuntimeCloud: runtimeCloud.ownership')
  expect(entry.indexOf('runtimeCloud.rpcReady(rpc)')).toBeGreaterThan(
    entry.indexOf('await rpc.start()')
  )
  const cloudStop = entry.indexOf('await runtimeCloud.stop()')
  expect(cloudStop).toBeGreaterThanOrEqual(0)
  expect(entry.indexOf('await rpc.stop()', cloudStop)).toBeGreaterThan(cloudStop)
})
