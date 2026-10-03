import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(() => ({ remove: vi.fn() }))
  }
}))
vi.mock('expo-network', () => ({
  getNetworkStateAsync: vi.fn(() => Promise.resolve({ isConnected: true, type: 'WIFI' })),
  addNetworkStateListener: vi.fn(() => ({ remove: vi.fn() }))
}))
vi.mock('expo-secure-store', () => ({}))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(1),
  randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
}))
vi.mock('../auth/mobile-auth-session', () => ({ useMobileAuthSession: vi.fn() }))
vi.mock('../transport/client-context', () => ({
  useForgetHostClient: vi.fn(),
  useRefreshHostClient: vi.fn()
}))

import type { MobileSession } from '../auth/mobile-sms-auth'
import { forgetAccountRuntimeClientsOnProviderUnmount } from './account-runtime-directory-provider'
import {
  createAccountRuntimeDirectoryOperationState,
  invalidateAccountRuntimeDirectoryOperations,
  runAccountRuntimeDirectoryOperation,
  selectAccountRuntimePresenceBatch
} from './account-runtime-directory-operations'
import { runCurrentAccountSessionOperation } from './account-runtime-session-operation'

type Deferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const mobileSession: MobileSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 2_000,
  sessionExpiresAt: 3_000,
  sessionProfile: 'TRUSTED',
  account: { accountId: 'account-a', displayName: 'Account A' },
  authorityId: 'authority-a'
}

describe('account Runtime directory operation gate', () => {
  it('round-robins large presence directories in bounded batches', () => {
    const runtimeRecordIds = Array.from({ length: 1_205 }, (_, index) => `runtime-${index}`)

    const first = selectAccountRuntimePresenceBatch(runtimeRecordIds, 0)
    const second = selectAccountRuntimePresenceBatch(runtimeRecordIds, first.nextOffset)
    const third = selectAccountRuntimePresenceBatch(runtimeRecordIds, second.nextOffset)

    expect(first.runtimeRecordIds).toHaveLength(500)
    expect(second.runtimeRecordIds).toHaveLength(500)
    expect(third.runtimeRecordIds).toEqual(runtimeRecordIds.slice(1_000))
    expect(third.nextOffset).toBe(0)
  })

  it('coalesces rapid full refresh and presence triggers independently', async () => {
    const state = createAccountRuntimeDirectoryOperationState()
    const refreshResult = deferred<void>()
    const presenceResult = deferred<void>()
    const refreshTask = vi.fn(() => refreshResult.promise)
    const presenceTask = vi.fn(() => presenceResult.promise)

    const firstRefresh = runAccountRuntimeDirectoryOperation(state, 'refresh', refreshTask)
    const secondRefresh = runAccountRuntimeDirectoryOperation(state, 'refresh', refreshTask)
    const firstPresence = runAccountRuntimeDirectoryOperation(state, 'presence', presenceTask)
    const secondPresence = runAccountRuntimeDirectoryOperation(state, 'presence', presenceTask)

    expect(secondRefresh).toBe(firstRefresh)
    expect(secondPresence).toBe(firstPresence)
    expect(refreshTask).toHaveBeenCalledTimes(1)
    expect(presenceTask).toHaveBeenCalledTimes(1)

    refreshResult.resolve()
    presenceResult.resolve()
    await Promise.all([firstRefresh, firstPresence])
  })

  it('invalidates old account results and permits a new account flight', async () => {
    const state = createAccountRuntimeDirectoryOperationState()
    const oldResult = deferred<void>()
    const commits: string[] = []
    let oldSignal: AbortSignal | null = null
    const oldFlight = runAccountRuntimeDirectoryOperation(
      state,
      'refresh',
      async (isCurrent, signal) => {
        oldSignal = signal
        await oldResult.promise
        if (isCurrent()) {
          commits.push('old')
        }
      }
    )

    invalidateAccountRuntimeDirectoryOperations(state)
    expect(oldSignal?.aborted).toBe(true)
    const newFlight = runAccountRuntimeDirectoryOperation(state, 'refresh', async (isCurrent) => {
      if (isCurrent()) {
        commits.push('new')
      }
    })
    oldResult.resolve()
    await Promise.all([oldFlight, newFlight])

    expect(commits).toEqual(['new'])
  })

  it('invalidates background work and blocks post-unmount commits', async () => {
    const state = createAccountRuntimeDirectoryOperationState()
    const backgroundResult = deferred<void>()
    const commits: string[] = []
    const backgroundFlight = runAccountRuntimeDirectoryOperation(
      state,
      'presence',
      async (isCurrent) => {
        await backgroundResult.promise
        if (isCurrent()) {
          commits.push('background')
        }
      }
    )

    invalidateAccountRuntimeDirectoryOperations(state)
    const unmountedResult = deferred<void>()
    const unmountedFlight = runAccountRuntimeDirectoryOperation(
      state,
      'presence',
      async (isCurrent) => {
        await unmountedResult.promise
        if (isCurrent()) {
          commits.push('unmounted')
        }
      }
    )
    invalidateAccountRuntimeDirectoryOperations(state)
    backgroundResult.resolve()
    unmountedResult.resolve()
    await Promise.all([backgroundFlight, unmountedFlight])

    expect(commits).toEqual([])
  })
})

describe('account Runtime directory provider teardown', () => {
  it('forgets account-only and local-fallback clients without refreshing either', () => {
    const forget = vi.fn()

    forgetAccountRuntimeClientsOnProviderUnmount(
      [
        {
          hostId: 'account-host',
          runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          resourceVersion: 1,
          accessMode: 'account-only'
        },
        {
          hostId: 'local-host',
          runtimeRecordId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          resourceVersion: 1,
          accessMode: 'local-fallback'
        }
      ],
      forget
    )

    expect(forget.mock.calls).toEqual([['account-host'], ['local-host']])
  })
})

describe('account Runtime authorization scope', () => {
  it('rejects a successful response after the account session is replaced', async () => {
    const result = deferred<string>()
    let current: MobileSession | null = mobileSession
    const pending = runCurrentAccountSessionOperation(
      mobileSession,
      () => current,
      () => result.promise
    )

    current = { ...mobileSession, sessionExpiresAt: 4_000 }
    result.resolve('stale-account-data')

    await expect(pending).rejects.toThrow('mobile_session_required')
  })

  it('accepts token rotation within the same account session', async () => {
    const refreshed = {
      ...mobileSession,
      accessToken: 'replacement-access-token',
      refreshToken: 'replacement-refresh-token'
    }

    await expect(
      runCurrentAccountSessionOperation(
        mobileSession,
        () => refreshed,
        async () => 'current-data'
      )
    ).resolves.toBe('current-data')
  })
})
