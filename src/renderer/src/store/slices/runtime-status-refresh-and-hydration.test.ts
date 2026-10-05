import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { createCompatibleRuntimeStatusResponse } from '../../runtime/runtime-compatibility-test-fixture'
import { clearRuntimeEnvironmentConnectionGenerationsForTests } from './runtime-status'
import { createTestStore } from './store-test-helpers'

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), dismiss: vi.fn() }
}))

function createSliceStore() {
  return createTestStore()
}

function makeStatus(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    runtimeId: 'rt',
    rendererGraphEpoch: 0,
    graphStatus: 'ready',
    authoritativeWindowId: null,
    liveTabCount: 0,
    liveLeafCount: 0,
    runtimeProtocolVersion: 3,
    minCompatibleRuntimeClientVersion: 3,
    ...overrides
  }
}

function makeEnvironment(
  overrides: Partial<PublicKnownRuntimeEnvironment> = {}
): PublicKnownRuntimeEnvironment {
  return {
    id: 'env-a',
    name: 'Dev Box',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    runtimeId: null,
    endpoints: [{ id: 'ws-a', kind: 'websocket', label: 'WebSocket', endpoint: 'ws://x' }],
    preferredEndpointId: 'ws-a',
    ...overrides
  }
}

function makeAccountClaim(): NonNullable<PublicKnownRuntimeEnvironment['accountClaim']> {
  return {
    runtimeRecordId: 'runtime-record-a',
    resourceVersion: 1,
    ownershipEpoch: 1,
    cloudDisplayName: null,
    cloudDisplayNameVersion: 1,
    presence: 'ONLINE',
    readiness: 'READY',
    readinessReasonCode: null,
    lastHeartbeatAt: null,
    freeDiskBytes: null,
    clientAuthMode: 'IDENTITY_PROOF',
    credentialState: 'IDENTITY_PROOF',
    connectionCapabilities: ['hive-relay'],
    cloudConnectable: true
  }
}

function stubRuntimeEnvironmentApi({
  getStatus = vi.fn(),
  list = vi.fn()
}: {
  getStatus?: ReturnType<typeof vi.fn>
  list?: ReturnType<typeof vi.fn>
}) {
  vi.stubGlobal('window', {
    api: {
      runtimeEnvironments: {
        getStatus,
        list
      }
    }
  })
  return { getStatus, list }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  clearRuntimeEnvironmentConnectionGenerationsForTests()
  vi.mocked(toast.warning).mockReset()
  vi.mocked(toast.dismiss).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('runtime-status refresh and hydration', () => {
  it('records null and returns false when a runtime refresh fails', async () => {
    const getStatus = vi.fn().mockRejectedValue(new Error('closed'))
    stubRuntimeEnvironmentApi({ getStatus })
    const store = createSliceStore()
    const cached = makeStatus()
    store.getState().setRuntimeEnvironmentStatus('env-a', { status: cached, checkedAt: 1 })

    const reachable = await store.getState().refreshRuntimeEnvironmentStatus('env-a')

    expect(reachable).toBe(false)
    expect(store.getState().runtimeStatusByEnvironmentId.get('env-a')?.status).toBe(null)
  })

  it('publishes successful reachability when reading its snapshot fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('window', {
      api: {
        runtimeEnvironments: {
          getStatus: vi.fn().mockResolvedValue(createCompatibleRuntimeStatusResponse('runtime-a')),
          getStatusSnapshots: vi.fn().mockRejectedValue(new Error('IPC read failed'))
        }
      }
    })
    try {
      const store = createSliceStore()
      expect(await store.getState().refreshRuntimeEnvironmentStatus('env-a')).toBe(true)
      expect(store.getState().runtimeStatusByEnvironmentId.get('env-a')?.status?.runtimeId).toBe(
        'runtime-a'
      )
      expect(log).toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  it('publishes a successful account-runtime probe when no local host snapshot exists', async () => {
    vi.stubGlobal('window', {
      api: {
        runtimeEnvironments: {
          getStatus: vi.fn().mockResolvedValue(createCompatibleRuntimeStatusResponse('runtime-a')),
          getStatusSnapshots: vi.fn().mockResolvedValue([])
        }
      }
    })
    const store = createSliceStore()

    expect(await store.getState().refreshRuntimeEnvironmentStatus('env-a')).toBe(true)
    expect(store.getState().runtimeStatusByEnvironmentId.get('env-a')?.status?.runtimeId).toBe(
      'runtime-a'
    )
  })

  it('prefers a successful cloud fallback over an unavailable local-pairing snapshot', async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(createCompatibleRuntimeStatusResponse('runtime-a'))
      .mockResolvedValueOnce({
        id: 'status.get',
        ok: false,
        error: { code: 'runtime_unavailable', message: 'offline' },
        _meta: { runtimeId: null }
      })
    vi.stubGlobal('window', {
      api: {
        runtimeEnvironments: {
          getStatus,
          getStatusSnapshots: vi.fn().mockResolvedValue([
            {
              environmentId: 'env-a',
              pairingRevision: 1,
              sequence: 1,
              checkedAt: 1,
              status: null,
              verification: 'unavailable',
              transport: 'disconnected'
            }
          ])
        }
      }
    })
    const store = createSliceStore()
    store.getState().setRuntimeEnvironments([
      makeEnvironment({
        pairingRevision: 1,
        accessSources: ['local-pairing', 'account-claimed'],
        accountClaim: makeAccountClaim()
      })
    ])

    expect(await store.getState().refreshRuntimeEnvironmentStatus('env-a')).toBe(true)
    expect(store.getState().runtimeStatusByEnvironmentId.get('env-a')?.status?.runtimeId).toBe(
      'runtime-a'
    )

    store.getState().applyRuntimeHostStatusSnapshot(
      {
        environmentId: 'env-a',
        pairingRevision: 1,
        sequence: 2,
        checkedAt: 2,
        status: null,
        verification: 'unavailable',
        transport: 'disconnected'
      },
      { suppressAlternateRouteRefresh: true }
    )
    expect(store.getState().runtimeStatusByEnvironmentId.get('env-a')?.status?.runtimeId).toBe(
      'runtime-a'
    )

    expect(await store.getState().refreshRuntimeEnvironmentStatus('env-a')).toBe(false)
    expect(store.getState().runtimeStatusByEnvironmentId.get('env-a')?.status).toBe(null)
  })

  it('hydrates saved environments through the single-environment refresh path', async () => {
    const getStatus = vi.fn().mockResolvedValue(createCompatibleRuntimeStatusResponse('runtime-a'))
    const list = vi.fn().mockResolvedValue([
      {
        id: 'env-a',
        name: 'Dev Box',
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: null,
        runtimeId: null,
        endpoints: [{ id: 'ws-a', kind: 'websocket', label: 'WebSocket', endpoint: 'ws://x' }],
        preferredEndpointId: 'ws-a'
      }
    ])
    stubRuntimeEnvironmentApi({ getStatus, list })
    const store = createSliceStore()

    await store.getState().hydrateRuntimeEnvironmentStatuses()

    expect(store.getState().runtimeEnvironments.map((environment) => environment.id)).toEqual([
      'env-a'
    ])
    expect(getStatus).toHaveBeenCalledWith({ selector: 'env-a', timeoutMs: 10_000 })
    expect(store.getState().runtimeStatusByEnvironmentId.get('env-a')?.status?.runtimeId).toBe(
      'runtime-a'
    )
  })

  it('shares one full catalog and status sweep across overlapping hydrations', async () => {
    const environments = [makeEnvironment(), makeEnvironment({ id: 'env-b', name: 'Build Box' })]
    const probeA = deferred<ReturnType<typeof createCompatibleRuntimeStatusResponse>>()
    const probeB = deferred<ReturnType<typeof createCompatibleRuntimeStatusResponse>>()
    const getStatus = vi.fn(({ selector }: { selector: string }) =>
      selector === 'env-a' ? probeA.promise : probeB.promise
    )
    const list = vi.fn().mockResolvedValue(environments)
    stubRuntimeEnvironmentApi({ getStatus, list })
    const store = createSliceStore()
    let publications = 0
    const unsubscribe = store.subscribe(() => {
      publications += 1
    })

    const first = store.getState().hydrateRuntimeEnvironmentStatuses()
    const second = store.getState().hydrateRuntimeEnvironmentStatuses()
    expect(list).toHaveBeenCalledTimes(1)
    expect(getStatus).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(2))
    const third = store.getState().hydrateRuntimeEnvironmentStatuses()

    probeA.resolve(createCompatibleRuntimeStatusResponse('runtime-a'))
    probeB.reject(new Error('offline'))
    await Promise.all([first, second, third])
    unsubscribe()

    expect(list).toHaveBeenCalledTimes(1)
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(publications).toBe(3)
    expect(store.getState().runtimeStatusByEnvironmentId.get('env-a')?.status?.runtimeId).toBe(
      'runtime-a'
    )
    expect(store.getState().runtimeStatusByEnvironmentId.get('env-b')?.status).toBeNull()
  })

  it('runs a fresh explicit hydration after the shared sweep settles', async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(createCompatibleRuntimeStatusResponse('runtime-1'))
      .mockResolvedValueOnce(createCompatibleRuntimeStatusResponse('runtime-2'))
    const list = vi.fn().mockResolvedValue([makeEnvironment()])
    stubRuntimeEnvironmentApi({ getStatus, list })
    const store = createSliceStore()
    let publications = 0
    const unsubscribe = store.subscribe(() => {
      publications += 1
    })

    await store.getState().hydrateRuntimeEnvironmentStatuses()
    await store.getState().hydrateRuntimeEnvironmentStatuses()
    unsubscribe()

    expect(list).toHaveBeenCalledTimes(2)
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(publications).toBe(3)
    expect(store.getState().runtimeStatusByEnvironmentId.get('env-a')?.status?.runtimeId).toBe(
      'runtime-2'
    )
  })

  it('does not share hydration work between stores', async () => {
    const list = vi.fn().mockResolvedValue([])
    stubRuntimeEnvironmentApi({ getStatus: vi.fn(), list })
    const firstStore = createSliceStore()
    const secondStore = createSliceStore()

    await Promise.all([
      firstStore.getState().hydrateRuntimeEnvironmentStatuses(),
      secondStore.getState().hydrateRuntimeEnvironmentStatuses()
    ])

    expect(list).toHaveBeenCalledTimes(2)
  })

  it('queues a current-catalog sweep when the catalog changes during listing', async () => {
    const environmentA = makeEnvironment({ pairingRevision: 1 })
    const repairedEnvironmentA = makeEnvironment({ pairingRevision: 2 })
    const firstCatalog = deferred<PublicKnownRuntimeEnvironment[]>()
    const secondCatalog = deferred<PublicKnownRuntimeEnvironment[]>()
    const getStatus = vi
      .fn()
      .mockResolvedValue(createCompatibleRuntimeStatusResponse('runtime-current'))
    const list = vi
      .fn()
      .mockReturnValueOnce(firstCatalog.promise)
      .mockReturnValueOnce(secondCatalog.promise)
    stubRuntimeEnvironmentApi({ getStatus, list })
    const store = createSliceStore()
    store.getState().setRuntimeEnvironments([environmentA])

    const hydration = store.getState().hydrateRuntimeEnvironmentStatuses()
    store.getState().setRuntimeEnvironments([repairedEnvironmentA])
    firstCatalog.resolve([environmentA])
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))

    expect(getStatus).not.toHaveBeenCalled()
    expect(store.getState().runtimeEnvironments).toEqual([repairedEnvironmentA])

    secondCatalog.resolve([repairedEnvironmentA])
    await hydration

    expect(list).toHaveBeenCalledTimes(2)
    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(store.getState().runtimeStatusByEnvironmentId.has('env-a')).toBe(true)
  })

  it('queues one current-catalog sweep when a host is removed during probing', async () => {
    const environmentA = makeEnvironment()
    const environmentB = makeEnvironment({ id: 'env-b', name: 'Build Box' })
    const firstProbe = deferred<ReturnType<typeof createCompatibleRuntimeStatusResponse>>()
    const getStatus = vi
      .fn()
      .mockImplementationOnce(() => firstProbe.promise)
      .mockResolvedValue(createCompatibleRuntimeStatusResponse('runtime-current'))
    const list = vi
      .fn()
      .mockResolvedValueOnce([environmentA, environmentB])
      .mockResolvedValueOnce([environmentA])
    stubRuntimeEnvironmentApi({ getStatus, list })
    const store = createSliceStore()

    const first = store.getState().hydrateRuntimeEnvironmentStatuses()
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(2))
    store.getState().setRuntimeEnvironments([environmentA])
    const joined = store.getState().hydrateRuntimeEnvironmentStatuses()
    firstProbe.resolve(createCompatibleRuntimeStatusResponse('runtime-old'))
    await Promise.all([first, joined])

    expect(list).toHaveBeenCalledTimes(2)
    expect(getStatus).toHaveBeenCalledTimes(3)
    expect(store.getState().runtimeStatusByEnvironmentId.get('env-a')?.status?.runtimeId).toBe(
      'runtime-current'
    )
    expect(store.getState().runtimeStatusByEnvironmentId.has('env-b')).toBe(false)
  })

  // Why: skill discovery waits for the catalog to settle. A rejected read must
  // release that wait without claiming the catalog is hydrated — host routing
  // uses `runtimeEnvironmentCatalogHydrated` to fail closed on an unknown
  // catalog, and an empty stale list must not be mistaken for "no runtimes".
  it('settles failed catalog reads and allows a later hydration retry', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('unreadable environments.json'))
      .mockResolvedValueOnce([])
    stubRuntimeEnvironmentApi({ getStatus: vi.fn(), list })
    const store = createSliceStore()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await store.getState().hydrateRuntimeEnvironmentStatuses()

      expect(store.getState().runtimeEnvironmentCatalogSettled).toBe(true)
      expect(store.getState().runtimeEnvironmentCatalogHydrated).toBe(false)
      expect(store.getState().runtimeEnvironments).toEqual([])

      await store.getState().hydrateRuntimeEnvironmentStatuses()
      expect(list).toHaveBeenCalledTimes(2)
      expect(store.getState().runtimeEnvironmentCatalogHydrated).toBe(true)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('both settles and hydrates the catalog on a successful read', async () => {
    const list = vi.fn().mockResolvedValue([])
    stubRuntimeEnvironmentApi({ getStatus: vi.fn(), list })
    const store = createSliceStore()

    await store.getState().hydrateRuntimeEnvironmentStatuses()

    expect(store.getState().runtimeEnvironmentCatalogSettled).toBe(true)
    expect(store.getState().runtimeEnvironmentCatalogHydrated).toBe(true)
  })
})
