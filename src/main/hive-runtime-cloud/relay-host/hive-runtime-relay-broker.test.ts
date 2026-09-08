import nacl from 'tweetnacl'
import { afterEach, expect, it, vi } from 'vitest'
import { HiveRuntimeRelayBroker } from './hive-runtime-relay-broker'
import type { CurrentHiveRuntimeCloudLeaseContext } from '../hive-runtime-cloud-lease-context'
import type { HiveRuntimeRelayAssignment } from './hive-runtime-relay-types'
import type { HiveRuntimeRelayControlClient } from './hive-runtime-relay-control-client'

const controls = vi.hoisted(() => ({
  instances: [] as {
    active: boolean
    connect: ReturnType<typeof vi.fn>
    refresh: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }[]
}))
vi.mock('./hive-runtime-relay-control-client', () => ({
  HiveRuntimeRelayControlClient: class {
    active = false
    constructor(_options: ConstructorParameters<typeof HiveRuntimeRelayControlClient>[0]) {
      controls.instances.push(this)
    }
    connect = vi.fn(async () => {
      this.active = true
    })
    refresh = vi.fn(async () => {})
    close = vi.fn(() => {
      this.active = false
    })
  }
}))
const contextFixture: CurrentHiveRuntimeCloudLeaseContext = {
  authorityId: 'hive-primary',
  identity: {
    schemaVersion: 1,
    runtimeInstanceId: 'runtime-1',
    privateKeyPkcs8: 'unused',
    publicKey: 'A'.repeat(43),
    createdAt: 1
  },
  tuple: {
    authorityGeneration: 1,
    runtimeRecordId: 'record-1',
    runtimeInstanceId: 'runtime-1',
    bootId: '10000000-0000-4000-8000-000000000001',
    heartbeatLeaseId: 'lease-1',
    leaseEpoch: 1,
    fencingEpoch: 1
  }
}

afterEach(() => vi.useRealTimers())
it.each([0, 0.5])(
  'bounds retry amplification with random=%s and cancels the retry timer on shutdown',
  async (random) => {
    vi.useFakeTimers()
    const raw = nacl.box.keyPair()
    const resolve = vi.fn(async () => {
      throw new Error('unavailable')
    })
    const provider = { resolve, refresh: vi.fn() }
    const broker = new HiveRuntimeRelayBroker({
      provider,
      getContext: () => structuredClone(contextFixture),
      getKeypair: () => ({ ...raw, publicKeyB64: Buffer.from(raw.publicKey).toString('base64') }),
      onAssigned: vi.fn(),
      onConnection: vi.fn(),
      onUnavailable: vi.fn(),
      random: () => random
    })
    broker.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(resolve).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(249)
    expect(resolve).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(9751)
    expect(resolve.mock.calls.length).toBeGreaterThan(1)
    expect(resolve.mock.calls.length).toBeLessThanOrEqual(random === 0 ? 41 : 6)
    await broker.stop()
    const attempts = resolve.mock.calls.length
    await vi.advanceTimersByTimeAsync(120000)
    expect(resolve).toHaveBeenCalledTimes(attempts)
    expect(vi.getTimerCount()).toBe(0)
  }
)

it('refreshes the same control in place and fences late renewal and resolution after a tuple change', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
  controls.instances.length = 0
  const raw = nacl.box.keyPair()
  let context: CurrentHiveRuntimeCloudLeaseContext = {
    authorityId: 'hive-primary',
    identity: {
      schemaVersion: 1,
      runtimeInstanceId: 'runtime-1',
      privateKeyPkcs8: 'unused',
      publicKey: 'A'.repeat(43),
      createdAt: 1
    },
    tuple: {
      authorityGeneration: 1,
      runtimeRecordId: 'record-1',
      runtimeInstanceId: 'runtime-1',
      bootId: '10000000-0000-4000-8000-000000000001',
      heartbeatLeaseId: 'lease-1',
      leaseEpoch: 1,
      fencingEpoch: 1
    }
  }
  const assignment: HiveRuntimeRelayAssignment = {
    context,
    binding: {
      relayHostId: 'abcdefghijklmnop',
      hostBindingVersion: 1,
      hostPublicKeyB64: 'A'.repeat(43)
    },
    cellOrigin: 'https://cell.example',
    cellId: 'cell-1',
    cellIncarnationId: '10000000-0000-4000-8000-000000000002',
    assignmentId: '10000000-0000-4000-8000-000000000003',
    assignmentEpoch: 1,
    controlGeneration: 1,
    relayHostId: 'abcdefghijklmnop',
    controlLease: 'initial' as HiveRuntimeRelayAssignment['controlLease'],
    controlLeaseExpiresAt: Date.now() + 60_000,
    hostPublicKeyB64: 'A'.repeat(43)
  }
  const resolve = vi.fn(async () => assignment)
  const refresh = vi.fn(async () => ({
    ...assignment,
    controlLeaseExpiresAt: Date.now() + 60_000,
    controlLease: 'renewed' as HiveRuntimeRelayAssignment['controlLease']
  }))
  const onAssigned = vi.fn()
  const onUnavailable = vi.fn()
  const broker = new HiveRuntimeRelayBroker({
    provider: { resolve, refresh },
    getContext: () => context,
    getKeypair: () => ({ ...raw, publicKeyB64: Buffer.from(raw.publicKey).toString('base64') }),
    onAssigned,
    onUnavailable,
    onConnection: vi.fn(),
    now: Date.now
  })
  broker.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(resolve).toHaveBeenCalledOnce()
  expect(controls.instances).toHaveLength(1)
  const control = controls.instances[0]
  const unavailableAtConnect = onUnavailable.mock.calls.length
  await vi.advanceTimersByTimeAsync(15_000)
  expect(resolve).toHaveBeenCalledOnce()
  expect(refresh).toHaveBeenCalledOnce()
  expect(control.refresh).toHaveBeenCalledOnce()
  expect(control.close).not.toHaveBeenCalled()
  expect(controls.instances).toHaveLength(1)
  expect(onUnavailable).toHaveBeenCalledTimes(unavailableAtConnect)

  let finishRefresh!: (value: HiveRuntimeRelayAssignment) => void
  refresh.mockImplementationOnce(
    () =>
      new Promise((complete) => {
        finishRefresh = complete
      })
  )
  await vi.advanceTimersByTimeAsync(15_000)
  expect(refresh).toHaveBeenCalledTimes(2)
  context = { ...context, tuple: { ...context.tuple, leaseEpoch: 2, heartbeatLeaseId: 'lease-2' } }
  broker.notifyContextChanged()
  expect(control.close).toHaveBeenCalledOnce()
  expect(broker.activeAssignment).toBeNull()
  finishRefresh({ ...assignment, controlLeaseExpiresAt: Date.now() + 60_000 })
  let finishResolve!: (value: HiveRuntimeRelayAssignment) => void
  resolve.mockImplementationOnce(
    () =>
      new Promise((complete) => {
        finishResolve = complete
      })
  )
  await vi.advanceTimersByTimeAsync(100)
  expect(resolve).toHaveBeenCalledTimes(2)
  expect(onAssigned).toHaveBeenCalledTimes(2)
  expect(control.refresh).toHaveBeenCalledOnce()
  const stale = { ...assignment, context }
  context = { ...context, tuple: { ...context.tuple, leaseEpoch: 3, heartbeatLeaseId: 'lease-3' } }
  broker.notifyContextChanged()
  const stopping = broker.stop()
  finishResolve(stale)
  await stopping
  await vi.advanceTimersByTimeAsync(120_000)
  expect(controls.instances).toHaveLength(1)
  expect(onAssigned).toHaveBeenCalledTimes(2)
  expect(resolve).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves pending resolution and retry delay across repeated heartbeat publications', async () => {
  vi.useFakeTimers()
  const raw = nacl.box.keyPair()
  let rejectResolve!: (error: Error) => void
  let signal!: AbortSignal
  const resolve = vi.fn((input: { signal?: AbortSignal }) => {
    signal = input.signal!
    return new Promise<HiveRuntimeRelayAssignment>((_complete, reject) => {
      rejectResolve = reject
    })
  })
  const onUnavailable = vi.fn()
  const broker = new HiveRuntimeRelayBroker({
    provider: { resolve, refresh: vi.fn() },
    getContext: () => structuredClone(contextFixture),
    getKeypair: () => ({ ...raw, publicKeyB64: Buffer.from(raw.publicKey).toString('base64') }),
    onAssigned: vi.fn(),
    onConnection: vi.fn(),
    onUnavailable,
    random: () => 0.5
  })
  broker.start()
  await vi.advanceTimersByTimeAsync(0)
  for (let publication = 0; publication < 100; publication++) {
    broker.notifyContextChanged()
  }
  expect(signal.aborted).toBe(false)
  expect(onUnavailable).toHaveBeenCalledOnce()
  expect(resolve).toHaveBeenCalledOnce()
  rejectResolve(new Error('unavailable'))
  await vi.advanceTimersByTimeAsync(0)
  for (let publication = 0; publication < 100; publication++) {
    broker.notifyContextChanged()
  }
  await vi.advanceTimersByTimeAsync(749)
  expect(resolve).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1)
  expect(resolve).toHaveBeenCalledTimes(2)
  expect(onUnavailable).toHaveBeenCalledOnce()
  rejectResolve(new Error('unavailable'))
  await vi.advanceTimersByTimeAsync(0)
  await broker.stop()
  expect(vi.getTimerCount()).toBe(0)
})
