import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileSession } from '../auth/mobile-sms-auth'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'
import {
  AccountRuntimeDirectoryProvider,
  useAccountRuntimeDirectory
} from './account-runtime-directory-provider'

const fixture = vi.hoisted(() => ({
  app: { currentState: 'active', addEventListener: vi.fn() },
  directory: vi.fn(),
  presence: vi.fn(),
  forget: vi.fn(),
  refreshClient: vi.fn(),
  refreshAuth: vi.fn(),
  reconcile: vi.fn(),
  queue: vi.fn(),
  cloud: vi.fn(() => null),
  names: new Map(),
  session: null as MobileSession | null
}))
vi.mock('react-native', () => ({ AppState: fixture.app }))
vi.mock('expo-secure-store', () => ({}))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length),
  randomUUID: () => 'test'
}))
vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ session: fixture.session, refresh: fixture.refreshAuth })
}))
vi.mock('../transport/client-context', () => ({
  useForgetHostClient: () => fixture.forget,
  useRefreshHostClient: () => fixture.refreshClient
}))
vi.mock('./account-runtime-directory-client', () => ({
  loadAllAccountRuntimes: (...args: unknown[]) => fixture.directory(...args),
  loadRuntimePresence: (...args: unknown[]) => fixture.presence(...args),
  loadRuntimeSessions: vi.fn(),
  revokeRuntimeSession: vi.fn()
}))
vi.mock('./use-account-runtime-display-name-sync', () => ({
  useAccountRuntimeDisplayNameSync: () => ({
    pendingDisplayNames: fixture.names,
    queueDisplayNameUpdate: fixture.queue,
    reconcileDirectory: fixture.reconcile
  })
}))
vi.mock('./use-account-runtime-cloud-profile', () => ({
  useAccountRuntimeCloudProfile: () => fixture.cloud
}))

const runtime: AccountRuntimeDirectoryEntry = {
  runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  status: 'CLAIMED',
  runtimeVersion: '1',
  runtimeProtocolVersion: 3,
  capabilities: [],
  resourceVersion: 1,
  createdAt: '2026-09-01T00:00:00Z',
  claimedAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  lastHeartbeatAt: null,
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: null,
  freeDiskBytes: null,
  connectionCapabilities: []
}
let renderer: ReactTestRenderer
let directory: ReturnType<typeof useAccountRuntimeDirectory>
function Probe() {
  directory = useAccountRuntimeDirectory()
  return null
}
function tree() {
  return createElement(AccountRuntimeDirectoryProvider, null, createElement(Probe))
}
async function state(next: string) {
  await act(async () => {
    fixture.app.currentState = next
    for (const [, listener] of fixture.app.addEventListener.mock.calls) {
      listener(next)
    }
  })
}
async function resumeAfter(ms: number) {
  await state('background')
  vi.setSystemTime(Date.now() + ms)
  await state('active')
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
  vi.clearAllMocks()
  fixture.app.currentState = 'active'
  fixture.app.addEventListener.mockReturnValue({ remove: vi.fn() })
  fixture.session = {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: 1_000_000,
    sessionExpiresAt: 2_000_000,
    sessionProfile: 'TRUSTED',
    account: { accountId: 'account-a', displayName: 'A' },
    authorityId: 'authority'
  }
  fixture.directory.mockReset().mockResolvedValue([runtime])
  fixture.presence
    .mockReset()
    .mockResolvedValue([{ ...runtime, observedAt: '2026-09-01T00:00:00Z' }])
  await act(async () => {
    renderer = create(tree())
  })
})
afterEach(() => {
  act(() => renderer.unmount())
  vi.useRealTimers()
})

describe('directory refresh on app resume', () => {
  it('reuses recent reads and ignores duplicate active events', async () => {
    await resumeAfter(5_000)
    await state('active')
    expect(fixture.directory).toHaveBeenCalledOnce()
    expect(fixture.presence).not.toHaveBeenCalled()
    expect(directory.state.status).toBe('ready')
  })

  it('refreshes only expired presence, then reuses that success', async () => {
    await resumeAfter(30_000)
    expect(fixture.directory).toHaveBeenCalledOnce()
    expect(fixture.presence).toHaveBeenCalledOnce()
    await resumeAfter(1_000)
    expect(fixture.presence).toHaveBeenCalledOnce()
  })

  it('uses a fresh full directory response without an extra presence request', async () => {
    await resumeAfter(300_000)
    expect(fixture.directory).toHaveBeenCalledTimes(2)
    expect(fixture.presence).not.toHaveBeenCalled()
  })

  it('retries failures on the next resume and preserves existing rows', async () => {
    fixture.presence.mockRejectedValueOnce(new Error('offline'))
    await resumeAfter(30_000)
    expect(directory.state.entries).toEqual([runtime])
    await resumeAfter(1_000)
    expect(fixture.presence).toHaveBeenCalledTimes(2)
  })

  it('forces explicit refresh and isolates replacement accounts', async () => {
    await act(async () => {
      await directory.refresh()
    })
    expect(fixture.directory).toHaveBeenCalledTimes(2)
    fixture.session = { ...fixture.session!, account: { accountId: 'account-b', displayName: 'B' } }
    fixture.directory.mockResolvedValue([])
    await act(async () => {
      renderer.update(tree())
    })
    expect(fixture.directory).toHaveBeenCalledTimes(3)
    expect(directory.state.entries).toEqual([])
    await resumeAfter(1_000)
    expect(fixture.directory).toHaveBeenCalledTimes(3)
  })

  it('retries a failed full refresh without clearing the last successful rows', async () => {
    fixture.directory.mockRejectedValueOnce(new Error('offline'))
    await resumeAfter(300_000)
    expect(directory.state).toMatchObject({ status: 'error', entries: [runtime] })
    await resumeAfter(1_000)
    expect(fixture.directory).toHaveBeenCalledTimes(3)
    expect(directory.state.status).toBe('ready')
  })

  it('does not cache a directory response cancelled by backgrounding', async () => {
    let resolve!: (value: AccountRuntimeDirectoryEntry[]) => void
    fixture.directory.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    await resumeAfter(300_000)
    await state('background')
    expect(fixture.directory.mock.calls[1]![2].aborted).toBe(true)
    await act(async () => {
      resolve([])
    })
    expect(directory.state.entries).toEqual([runtime])
    await state('active')
    expect(fixture.directory).toHaveBeenCalledTimes(3)
    expect(directory.state.status).toBe('ready')
  })

  it('shares freshness with periodic polling', async () => {
    await resumeAfter(30_000)
    expect(fixture.presence).toHaveBeenCalledOnce()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(fixture.presence).toHaveBeenCalledOnce()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000)
    })
    expect(fixture.directory).toHaveBeenCalledTimes(2)
  })
})
