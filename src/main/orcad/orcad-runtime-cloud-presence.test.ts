import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud/hive-runtime-cloud-presence-service'
import type * as PresenceSupport from '../hive-runtime-cloud/hive-runtime-cloud-presence-support'
import type * as CloudClient from '../hive-runtime-cloud/hive-runtime-cloud-client'
import type * as IdentityStore from '../hive-runtime-cloud/hive-runtime-cloud-identity-store'
import type * as StateStore from '../hive-runtime-cloud/hive-runtime-cloud-state-store'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import {
  authorization,
  claimedState,
  identity,
  refreshedAuthorization
} from '../hive-runtime-cloud/hive-runtime-cloud-presence-test-fixture'

const mock = vi.hoisted(() => ({
  lookup: vi.fn(),
  acquireLease: vi.fn(),
  heartbeat: vi.fn(),
  analyze: vi.fn(),
  clearIdentity: vi.fn(),
  clearState: vi.fn(),
  context: vi.fn(),
  presence: vi.fn<() => HiveRuntimeCloudPresenceService | null>()
}))
vi.mock('../hive-runtime-cloud/hive-runtime-cloud-presence-support', async (importOriginal) => {
  const actual = await importOriginal<typeof PresenceSupport>()
  return {
    ...actual,
    defaultPresenceDependencies: { ...actual.defaultPresenceDependencies, now: () => Date.now() }
  }
})
vi.mock('../hive-runtime-cloud/hive-runtime-cloud-client', async (importOriginal) => ({
  ...(await importOriginal<typeof CloudClient>()),
  HiveRuntimeCloudClient: class {
    lookup = mock.lookup
    acquireLease = mock.acquireLease
    heartbeat = mock.heartbeat
    analyze = mock.analyze
  }
}))
vi.mock('../hive-runtime-cloud/hive-runtime-cloud-identity-store', async (importOriginal) => ({
  ...(await importOriginal<typeof IdentityStore>()),
  getOrCreateHiveRuntimeCloudServiceIdentity: () => ({ status: 'ok', identity }),
  clearHiveRuntimeCloudServiceIdentity: mock.clearIdentity
}))
vi.mock('../hive-runtime-cloud/hive-runtime-cloud-state-store', async (importOriginal) => ({
  ...(await importOriginal<typeof StateStore>()),
  readHiveRuntimeCloudServiceRegistrationState: () => ({ status: 'ok', value: claimedState() }),
  saveHiveRuntimeCloudServiceRegistrationState: () => true,
  clearHiveRuntimeCloudServiceRegistrationState: mock.clearState
}))
vi.mock('../hive-runtime-cloud/relay-host/hive-runtime-relay-host-service', () => ({
  HiveRuntimeRelayHostService: class {
    private unsubscribe: (() => void) | undefined
    constructor(options: { presence: HiveRuntimeCloudPresenceService }) {
      mock.presence.mockReturnValue(options.presence)
    }
    start() {
      this.unsubscribe = mock.presence()?.subscribeLeaseContext(mock.context)
    }
    getStatus() {
      return 'offline'
    }
    async stop() {
      this.unsubscribe?.()
    }
  }
}))
import { createOrcadRuntimeCloud } from './orcad-runtime-cloud'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-04T00:00:00Z'))
  mock.lookup.mockResolvedValue({
    exists: true,
    ...claimedState(),
    identityPublicKeySha256: createHash('sha256')
      .update(Buffer.from(identity.publicKey, 'base64url'))
      .digest('hex')
  })
  mock.acquireLease.mockResolvedValue({
    leaseId: '823e4567-e89b-42d3-a456-426614174000',
    authorityGeneration: 1,
    leaseEpoch: 1,
    fencingEpoch: 1
  })
  mock.heartbeat.mockImplementation(async (request: { heartbeatSeq: number }) => ({
    leaseId: '823e4567-e89b-42d3-a456-426614174000',
    authorityGeneration: 1,
    leaseEpoch: 1,
    fencingEpoch: 1,
    acceptedHeartbeatSeq: request.heartbeatSeq,
    observedAt: Date.now(),
    leaseExpiresAt: Date.now() + 90_000,
    presence: 'ONLINE',
    duplicate: false
  }))
})
afterEach(() => vi.useRealTimers())

function fixture(withAccount = true) {
  const listeners = new Set<(auth: HiveRuntimeCloudAuthorization | null) => void>()
  let current: HiveRuntimeCloudAuthorization | null = null
  const unsubscribe = vi.fn()
  const cloud = createOrcadRuntimeCloud({
    userDataPath: '/unused',
    runtimeVersion: '1.5.0-beta.24',
    runtime: { getStartedAt: () => 1, getStatus: () => ({ graphStatus: 'ready' }) },
    env: {},
    ...(withAccount
      ? {
          account: {
            getRuntimeCloudAuthorization: () => current,
            subscribeRuntimeCloudAuthorization: (
              listener: (auth: HiveRuntimeCloudAuthorization | null) => void
            ) => {
              listeners.add(listener)
              return () => {
                listeners.delete(listener)
                unsubscribe()
              }
            }
          }
        }
      : {})
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The mocked Relay Host never reads RPC methods; this test only observes real Presence authorization.
  cloud.rpcReady({} as OrcaRuntimeRpcServer)
  return {
    cloud,
    unsubscribe,
    authorize(auth: HiveRuntimeCloudAuthorization | null) {
      current = auth
      for (const listener of listeners) {
        listener(auth)
      }
    }
  }
}

it('keeps an unauthenticated Node host local and preserves its Runtime claim', async () => {
  const { cloud } = fixture(false)
  await vi.advanceTimersByTimeAsync(180_000)
  expect(cloud.getPresenceState()).toBe('SIGNED_OUT')
  expect(cloud.ownership.getLocalRuntimeStatus()).toMatchObject({ ownership: 'CLAIMED' })
  expect(mock.lookup).not.toHaveBeenCalled()
  expect(mock.acquireLease).not.toHaveBeenCalled()
  expect(mock.heartbeat).not.toHaveBeenCalled()
  expect(mock.clearIdentity).not.toHaveBeenCalled()
  expect(mock.clearState).not.toHaveBeenCalled()
  await cloud.stop()
})

it('uses the native account source and synchronously fences sign-out while retaining the claim', async () => {
  const { cloud, authorize, unsubscribe } = fixture()
  authorize(authorization)
  await vi.advanceTimersByTimeAsync(0)
  expect(cloud.getPresenceState()).toBe('ONLINE')
  expect(mock.acquireLease).toHaveBeenCalledOnce()
  authorize(refreshedAuthorization())
  await vi.advanceTimersByTimeAsync(0)
  expect(mock.acquireLease).toHaveBeenCalledOnce()
  authorize(null)
  expect(cloud.getPresenceState()).toBe('SIGNED_OUT')
  expect(mock.presence()?.getCurrentLeaseContext()).toBeNull()
  expect(mock.context).toHaveBeenLastCalledWith(null)
  const heartbeats = mock.heartbeat.mock.calls.length
  await vi.advanceTimersByTimeAsync(180_000)
  expect(mock.heartbeat).toHaveBeenCalledTimes(heartbeats)
  expect(mock.clearIdentity).not.toHaveBeenCalled()
  expect(mock.clearState).not.toHaveBeenCalled()
  expect(cloud.ownership.getLocalRuntimeStatus().ownership).toBe('CLAIMED')
  await cloud.stop()
  expect(unsubscribe).toHaveBeenCalledOnce()
  authorize(authorization)
  expect(cloud.getPresenceState()).toBe('STOPPED')
})

it('fences an expired native source without another Cloud request', async () => {
  const { cloud, authorize } = fixture()
  authorize({ ...authorization, sessionExpiresAt: Date.now() + 1_000 })
  await vi.advanceTimersByTimeAsync(0)
  expect(cloud.getPresenceState()).toBe('ONLINE')
  const heartbeats = mock.heartbeat.mock.calls.length
  await vi.advanceTimersByTimeAsync(2_000)
  expect(cloud.getPresenceState()).toBe('SIGNED_OUT')
  expect(mock.context).toHaveBeenLastCalledWith(null)
  expect(mock.heartbeat).toHaveBeenCalledTimes(heartbeats)
  await cloud.stop()
})
