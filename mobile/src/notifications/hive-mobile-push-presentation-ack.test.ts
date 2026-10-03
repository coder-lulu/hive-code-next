import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) }
}))
vi.mock('expo-secure-store', () => ({}))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length),
  randomUUID: () => '11111111-1111-4111-8111-111111111111'
}))

import type { MobileSession } from '../auth/mobile-sms-session'
import {
  HiveMobilePushPresentationAckCoordinator,
  type HiveMobilePushPresentationAckDependencies
} from './hive-mobile-push-presentation-ack'

const DELIVERY_ID = '22222222-2222-4222-8222-222222222222'
const SECOND_DELIVERY_ID = '33333333-3333-4333-8333-333333333333'
const ACCOUNT_ID = 'account-id'
const SECOND_ACCOUNT_ID = 'second-account-id'
const DEVICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SECOND_DEVICE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TTL_MS = 25 * 60 * 60 * 1_000

type StoredPendingAck = Readonly<{
  accountId: string
  deviceId: string
  deliveryId: string
}>

function inactiveRetryTimer(): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => undefined, 0)
  clearTimeout(timer)
  return timer
}

function isStoredPendingAck(value: unknown): value is StoredPendingAck {
  return (
    value !== null &&
    typeof value === 'object' &&
    'accountId' in value &&
    typeof value.accountId === 'string' &&
    'deviceId' in value &&
    typeof value.deviceId === 'string' &&
    'deliveryId' in value &&
    typeof value.deliveryId === 'string'
  )
}

function parseStoredPending(raw: string): StoredPendingAck[] {
  const state: unknown = JSON.parse(raw)
  if (
    state === null ||
    typeof state !== 'object' ||
    !('pending' in state) ||
    !Array.isArray(state.pending) ||
    !state.pending.every(isStoredPendingAck)
  ) {
    throw new Error('Expected a valid pending acknowledgement state')
  }
  return state.pending
}

function accessTokenForDevice(
  deviceId?: string,
  sessionId = '11111111-1111-4111-8111-111111111111'
): string {
  const payload = btoa(
    JSON.stringify({
      session_id: sessionId,
      session_security_version: 1,
      ...(deviceId ? { device_id: deviceId, device_security_version: 1 } : {})
    })
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${payload}.signature`
}

const session: MobileSession = {
  accessToken: accessTokenForDevice(DEVICE_ID),
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 60_000,
  sessionExpiresAt: Date.now() + 120_000,
  sessionProfile: 'TRUSTED',
  account: { accountId: ACCOUNT_ID, displayName: 'User' },
  authorityId: 'authority-id'
}
const secondSession: MobileSession = {
  ...session,
  accessToken: accessTokenForDevice(SECOND_DEVICE_ID, '44444444-4444-4444-8444-444444444444'),
  account: { accountId: SECOND_ACCOUNT_ID, displayName: 'Second user' }
}
const sameAccountSecondDeviceSession: MobileSession = {
  ...session,
  accessToken: secondSession.accessToken
}
const sessionWithoutDevice: MobileSession = {
  ...session,
  accessToken: accessTokenForDevice()
}

function fixture(overrides: Partial<HiveMobilePushPresentationAckDependencies> = {}) {
  const values = new Map<string, string>()
  let now = 1_000
  let retryListener: (() => void) | null = null
  const acknowledge = overrides.acknowledge ?? vi.fn(async () => undefined)
  const scheduleRetry =
    overrides.scheduleRetry ??
    vi.fn((listener: () => void) => {
      retryListener = listener
      return inactiveRetryTimer()
    })
  const cancelRetry =
    overrides.cancelRetry ??
    vi.fn(() => {
      retryListener = null
    })
  const dependencies: HiveMobilePushPresentationAckDependencies = {
    storage: {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        values.set(key, value)
      })
    },
    acknowledge,
    scheduleRetry,
    cancelRetry,
    loadStoredSession: vi.fn(async () => null),
    now: () => now,
    ...overrides
  }
  return {
    coordinator: new HiveMobilePushPresentationAckCoordinator(dependencies),
    acknowledge,
    scheduleRetry,
    cancelRetry,
    values,
    fireRetry() {
      const listener = retryListener
      retryListener = null
      listener?.()
    },
    retryListener: () => retryListener,
    setNow(value: number) {
      now = value
    }
  }
}

function pendingIds(values: ReadonlyMap<string, string>): string[] {
  const raw = values.values().next().value
  if (!raw) {
    return []
  }
  return parseStoredPending(raw).map((entry) => entry.deliveryId)
}

function pendingScopes(
  values: ReadonlyMap<string, string>
): { accountId: string; deliveryId: string }[] {
  const raw = values.values().next().value
  if (!raw) {
    return []
  }
  return parseStoredPending(raw).map(({ accountId, deliveryId }) => ({ accountId, deliveryId }))
}

function pendingDeviceScopes(
  values: ReadonlyMap<string, string>
): { accountId: string; deviceId?: string; deliveryId: string }[] {
  const raw = values.values().next().value
  if (!raw) {
    return []
  }
  return parseStoredPending(raw).map(({ accountId, deviceId, deliveryId }) => ({
    accountId,
    deviceId,
    deliveryId
  }))
}

function indexedDeliveryId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

describe('Hive mobile push presentation acknowledgements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists a presentation before immediately flushing it with the current session', async () => {
    const state = fixture()
    vi.mocked(state.acknowledge).mockImplementation(async () => {
      expect(pendingIds(state.values)).toEqual([DELIVERY_ID])
    })
    state.coordinator.setSession(session)

    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()

    expect(state.acknowledge).toHaveBeenCalledWith(session, DELIVERY_ID)
    expect(pendingIds(state.values)).toEqual([])
  })

  it('retains transient failures and replays them after a process restart', async () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        values.set(key, value)
      })
    }
    const failed = new HiveMobilePushPresentationAckCoordinator({
      storage,
      acknowledge: vi.fn(async () => {
        throw new Error('offline')
      }),
      scheduleRetry: inactiveRetryTimer,
      cancelRetry: () => undefined,
      loadStoredSession: vi.fn(async () => null),
      now: () => 1_000
    })
    failed.setSession(session)
    await failed.record(DELIVERY_ID, ACCOUNT_ID)
    await failed.flush()
    expect(pendingIds(values)).toEqual([DELIVERY_ID])

    const acknowledge = vi.fn(async () => undefined)
    const restarted = new HiveMobilePushPresentationAckCoordinator({
      storage,
      acknowledge,
      scheduleRetry: inactiveRetryTimer,
      cancelRetry: () => undefined,
      loadStoredSession: vi.fn(async () => null),
      now: () => 2_000
    })
    restarted.setSession(session)
    await restarted.flush()

    expect(acknowledge).toHaveBeenCalledWith(session, DELIVERY_ID)
    expect(pendingIds(values)).toEqual([])
  })

  it('expires pending acknowledgements after 25 hours', async () => {
    const state = fixture({
      acknowledge: vi.fn(async () => {
        throw new Error('offline')
      })
    })
    state.coordinator.setSession(session)
    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()
    expect(pendingIds(state.values)).toEqual([DELIVERY_ID])

    state.setNow(1_000 + TTL_MS)
    vi.mocked(state.acknowledge).mockClear()
    await state.coordinator.flush()

    expect(state.acknowledge).not.toHaveBeenCalled()
    expect(pendingIds(state.values)).toEqual([])
  })

  it('does not persist an unscoped acknowledgement without a stored session', async () => {
    const loadStoredSession = vi.fn(async () => null)
    const state = fixture({ loadStoredSession })

    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)

    expect(loadStoredSession).toHaveBeenCalledOnce()
    expect(state.values.size).toBe(0)
    expect(state.acknowledge).not.toHaveBeenCalled()
  })

  it('scopes a cold-start acknowledgement to the stored session before hydration', async () => {
    const loadStoredSession = vi.fn(async () => session)
    const state = fixture({ loadStoredSession })

    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)

    expect(loadStoredSession).toHaveBeenCalledOnce()
    expect(pendingDeviceScopes(state.values)).toEqual([
      {
        accountId: session.account.accountId,
        deviceId: DEVICE_ID,
        deliveryId: DELIVERY_ID
      }
    ])
    expect(state.acknowledge).not.toHaveBeenCalled()

    state.coordinator.setSession(session)
    await state.coordinator.flush()

    expect(state.acknowledge).toHaveBeenCalledWith(session, DELIVERY_ID)
    expect(pendingDeviceScopes(state.values)).toEqual([])
  })

  it('does not bind a missing or mismatched event account to the current session', async () => {
    const state = fixture()
    state.coordinator.setSession(session)

    await state.coordinator.record(DELIVERY_ID, undefined)
    await state.coordinator.record(SECOND_DELIVERY_ID, SECOND_ACCOUNT_ID)

    expect(state.values.size).toBe(0)
    expect(state.acknowledge).not.toHaveBeenCalled()
  })

  it('retains and retries a 404 response under the current presentation protocol', async () => {
    let unavailable = true
    const state = fixture({
      acknowledge: vi.fn(async () => {
        if (unavailable) {
          throw { status: 404 }
        }
      })
    })
    state.coordinator.setSession(session)
    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()

    expect(state.acknowledge).toHaveBeenCalledTimes(1)
    expect(pendingIds(state.values)).toEqual([DELIVERY_ID])

    unavailable = false
    await state.coordinator.flush()

    expect(state.acknowledge).toHaveBeenCalledTimes(2)
    expect(pendingIds(state.values)).toEqual([])
  })

  it('automatically retries the same session with capped exponential backoff', async () => {
    let failuresRemaining = 8
    const acknowledge = vi.fn(async () => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1
        throw new Error('rate limited')
      }
    })
    const state = fixture({ acknowledge })
    state.coordinator.setSession(session)
    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()

    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]
    for (const [index, delay] of expectedDelays.entries()) {
      expect(state.scheduleRetry).toHaveBeenNthCalledWith(index + 1, expect.any(Function), delay)
      state.fireRetry()
      await state.coordinator.flush()
    }

    expect(acknowledge).toHaveBeenCalledTimes(9)
    expect(pendingIds(state.values)).toEqual([])
  })

  it('waits at least one rolling rate-limit window before retrying a 429', async () => {
    const state = fixture({
      acknowledge: vi.fn(async () => {
        throw { status: 429 }
      })
    })
    state.coordinator.setSession(session)
    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()

    expect(state.scheduleRetry).toHaveBeenLastCalledWith(expect.any(Function), 60_000)
    expect(pendingIds(state.values)).toEqual([DELIVERY_ID])
  })

  it('keeps new acknowledgements behind backoff until an explicit flush', async () => {
    const acknowledge = vi.fn(async () => {
      throw new Error('offline')
    })
    const state = fixture({ acknowledge })
    state.coordinator.setSession(session)
    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()
    acknowledge.mockClear()
    vi.mocked(state.cancelRetry).mockClear()

    await state.coordinator.record(SECOND_DELIVERY_ID, ACCOUNT_ID)
    await Promise.resolve()

    expect(state.cancelRetry).not.toHaveBeenCalled()
    expect(acknowledge).not.toHaveBeenCalled()
    expect(pendingIds(state.values)).toEqual([DELIVERY_ID, SECOND_DELIVERY_ID])

    await state.coordinator.flush()

    expect(state.cancelRetry).toHaveBeenCalledOnce()
    expect(acknowledge).toHaveBeenCalledWith(session, DELIVERY_ID)
  })

  it('cancels a stale retry when the session stops or changes scope', async () => {
    const acknowledge = vi.fn(async () => {
      throw new Error('offline')
    })
    const state = fixture({ acknowledge })
    state.coordinator.setSession(session)
    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()
    const staleRetry = state.retryListener()
    expect(staleRetry).not.toBeNull()

    state.coordinator.setSession(null)
    state.coordinator.setSession(secondSession)
    await state.coordinator.flush()
    acknowledge.mockClear()
    staleRetry?.()
    await Promise.resolve()
    await state.coordinator.flush()

    expect(state.cancelRetry).toHaveBeenCalled()
    expect(acknowledge).not.toHaveBeenCalled()
    expect(pendingIds(state.values)).toEqual([DELIVERY_ID])
  })

  it('never sends or deletes another account pending acknowledgement', async () => {
    let failFirstAccount = true
    const acknowledge = vi.fn(async (current: MobileSession) => {
      if (current.account.accountId === session.account.accountId && failFirstAccount) {
        throw new Error('offline')
      }
    })
    const state = fixture({ acknowledge })
    state.coordinator.setSession(session)
    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()
    acknowledge.mockClear()

    state.coordinator.setSession(secondSession)
    await state.coordinator.flush()
    expect(acknowledge).not.toHaveBeenCalled()
    expect(pendingScopes(state.values)).toEqual([
      { accountId: session.account.accountId, deliveryId: DELIVERY_ID }
    ])

    await state.coordinator.record(SECOND_DELIVERY_ID, SECOND_ACCOUNT_ID)
    await state.coordinator.flush()
    expect(acknowledge).toHaveBeenCalledWith(secondSession, SECOND_DELIVERY_ID)
    expect(pendingScopes(state.values)).toEqual([
      { accountId: session.account.accountId, deliveryId: DELIVERY_ID }
    ])

    acknowledge.mockClear()
    failFirstAccount = false
    state.coordinator.setSession(session)
    await state.coordinator.flush()
    expect(acknowledge).toHaveBeenCalledWith(session, DELIVERY_ID)
    expect(pendingScopes(state.values)).toEqual([])
  })

  it('continues with the new account when the previous account request fails in flight', async () => {
    let rejectFirst!: (failure: Error) => void
    const firstRequest = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    const acknowledge = vi.fn((current: MobileSession) =>
      current.account.accountId === session.account.accountId ? firstRequest : Promise.resolve()
    )
    const state = fixture({ acknowledge })
    state.coordinator.setSession(session)
    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledWith(session, DELIVERY_ID))

    state.coordinator.setSession(secondSession)
    await state.coordinator.record(SECOND_DELIVERY_ID, SECOND_ACCOUNT_ID)
    const activeFlush = state.coordinator.flush()
    rejectFirst(new Error('offline'))
    await activeFlush

    expect(acknowledge).toHaveBeenCalledWith(secondSession, SECOND_DELIVERY_ID)
  })

  it('never sends or deletes another device pending acknowledgement for the same account', async () => {
    let failFirstDevice = true
    const acknowledge = vi.fn(async (current: MobileSession) => {
      if (current.accessToken === session.accessToken && failFirstDevice) {
        throw new Error('offline')
      }
    })
    const state = fixture({ acknowledge })
    state.coordinator.setSession(session)
    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()
    acknowledge.mockClear()

    state.coordinator.setSession(sameAccountSecondDeviceSession)
    await state.coordinator.flush()
    expect(acknowledge).not.toHaveBeenCalled()
    expect(pendingDeviceScopes(state.values)).toEqual([
      {
        accountId: session.account.accountId,
        deviceId: DEVICE_ID,
        deliveryId: DELIVERY_ID
      }
    ])

    await state.coordinator.record(SECOND_DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()
    expect(acknowledge).toHaveBeenCalledWith(sameAccountSecondDeviceSession, SECOND_DELIVERY_ID)
    expect(pendingDeviceScopes(state.values)).toEqual([
      {
        accountId: session.account.accountId,
        deviceId: DEVICE_ID,
        deliveryId: DELIVERY_ID
      }
    ])

    acknowledge.mockClear()
    failFirstDevice = false
    state.coordinator.setSession(session)
    await state.coordinator.flush()
    expect(acknowledge).toHaveBeenCalledWith(session, DELIVERY_ID)
    expect(pendingDeviceScopes(state.values)).toEqual([])
  })

  it('does not record or send acknowledgements without a device claim', async () => {
    const acknowledge = vi.fn(async () => {
      throw new Error('offline')
    })
    const state = fixture({ acknowledge })
    state.coordinator.setSession(session)
    await state.coordinator.record(DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()
    acknowledge.mockClear()

    state.coordinator.setSession(sessionWithoutDevice)
    await state.coordinator.record(SECOND_DELIVERY_ID, ACCOUNT_ID)
    await state.coordinator.flush()

    expect(acknowledge).not.toHaveBeenCalled()
    expect(pendingIds(state.values)).toEqual([DELIVERY_ID])
  })

  it('keeps only the newest 512 scoped acknowledgements', async () => {
    const never = new Promise<void>(() => undefined)
    const acknowledge = vi.fn(() => never)
    const state = fixture({ acknowledge })
    state.coordinator.setSession(session)

    await state.coordinator.record(indexedDeliveryId(0), ACCOUNT_ID)
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledOnce())
    for (let index = 1; index <= 511; index++) {
      await state.coordinator.record(indexedDeliveryId(index), ACCOUNT_ID)
    }
    await state.coordinator.record(indexedDeliveryId(0), ACCOUNT_ID)
    await state.coordinator.record(indexedDeliveryId(512), ACCOUNT_ID)

    const pending = pendingScopes(state.values)
    expect(pending).toHaveLength(512)
    expect(pending[0]).toEqual({
      accountId: session.account.accountId,
      deliveryId: indexedDeliveryId(2)
    })
    expect(pending.at(-2)).toEqual({
      accountId: session.account.accountId,
      deliveryId: indexedDeliveryId(0)
    })
    expect(pending.at(-1)).toEqual({
      accountId: session.account.accountId,
      deliveryId: indexedDeliveryId(512)
    })
  })

  it('does not let one account capacity evict another account pending acknowledgement', async () => {
    const never = new Promise<void>(() => undefined)
    const acknowledge = vi.fn(() => never)
    const state = fixture({ acknowledge })
    state.coordinator.setSession(secondSession)
    await state.coordinator.record(SECOND_DELIVERY_ID, SECOND_ACCOUNT_ID)
    await vi.waitFor(() =>
      expect(acknowledge).toHaveBeenCalledWith(secondSession, SECOND_DELIVERY_ID)
    )

    state.coordinator.setSession(session)
    for (let index = 0; index <= 512; index++) {
      await state.coordinator.record(indexedDeliveryId(index), ACCOUNT_ID)
    }

    const pending = pendingScopes(state.values)
    expect(pending.filter((entry) => entry.accountId === session.account.accountId)).toEqual(
      Array.from({ length: 512 }, (_, offset) => ({
        accountId: session.account.accountId,
        deliveryId: indexedDeliveryId(offset + 1)
      }))
    )
    expect(pending.filter((entry) => entry.accountId === secondSession.account.accountId)).toEqual([
      { accountId: secondSession.account.accountId, deliveryId: SECOND_DELIVERY_ID }
    ])
  })

  it('does not let one device capacity evict another device for the same account', async () => {
    const never = new Promise<void>(() => undefined)
    const acknowledge = vi.fn(() => never)
    const state = fixture({ acknowledge })
    state.coordinator.setSession(sameAccountSecondDeviceSession)
    await state.coordinator.record(SECOND_DELIVERY_ID, ACCOUNT_ID)
    await vi.waitFor(() =>
      expect(acknowledge).toHaveBeenCalledWith(sameAccountSecondDeviceSession, SECOND_DELIVERY_ID)
    )

    state.coordinator.setSession(session)
    for (let index = 0; index <= 512; index++) {
      await state.coordinator.record(indexedDeliveryId(index), ACCOUNT_ID)
    }

    const pending = pendingDeviceScopes(state.values)
    const firstDevicePending = pending.filter((entry) => entry.deviceId === DEVICE_ID)
    expect(firstDevicePending).toHaveLength(512)
    expect(firstDevicePending[0]?.deliveryId).toBe(indexedDeliveryId(1))
    expect(firstDevicePending.at(-1)?.deliveryId).toBe(indexedDeliveryId(512))
    expect(pending.filter((entry) => entry.deviceId === SECOND_DEVICE_ID)).toEqual([
      {
        accountId: session.account.accountId,
        deviceId: SECOND_DEVICE_ID,
        deliveryId: SECOND_DELIVERY_ID
      }
    ])
  })

  it('enforces global capacity when enqueueing across many isolated scopes', async () => {
    let raw = JSON.stringify({
      schemaVersion: 2,
      pending: Array.from({ length: 4_096 }, (_, index) => ({
        accountId: `other-account-${Math.floor(index / 512)}`,
        deviceId: DEVICE_ID,
        deliveryId: indexedDeliveryId(index),
        presentedAt: 1_000 + index
      }))
    })
    const storage = {
      getItem: vi.fn(async () => raw),
      setItem: vi.fn(async (_key: string, value: string) => {
        raw = value
      })
    }
    const coordinator = new HiveMobilePushPresentationAckCoordinator({
      storage,
      acknowledge: vi.fn(() => new Promise<void>(() => undefined)),
      scheduleRetry: inactiveRetryTimer,
      cancelRetry: () => undefined,
      loadStoredSession: vi.fn(async () => null),
      now: () => 10_000
    })
    coordinator.setSession(session)

    await coordinator.record(DELIVERY_ID, ACCOUNT_ID)

    const pending = parseStoredPending(raw)
    expect(pending).toHaveLength(4_096)
    expect(pending.some((entry) => entry.deliveryId === indexedDeliveryId(0))).toBe(false)
    expect(pending.at(-1)).toMatchObject({
      accountId: ACCOUNT_ID,
      deliveryId: DELIVERY_ID
    })
  })
})
