import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('expo-secure-store', () => ({}))
vi.mock('expo-crypto', () => ({}))
const { createConnection, loadDirectory } = vi.hoisted(() => ({
  createConnection: vi.fn(),
  loadDirectory: vi.fn()
}))
vi.mock('./account-runtime-directory-client', () => ({
  createAccountRuntimeConnectionIntent: createConnection,
  loadAllAccountRuntimes: loadDirectory
}))
import { MobileApiError } from '../auth/mobile-sms-client'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'
import type { MobileSession } from '../auth/mobile-sms-auth'
import type { HostProfile } from '../transport/types'
import type { HiveAccountRelayMaterial } from '../../../src/shared/hive-account-relay-material'
import { AccountRuntimeDirectoryStore } from './account-runtime-directory-store'
import { useAccountRuntimeCloudProfile } from './use-account-runtime-cloud-profile'

async function setup() {
  const session = {
    authorityId: 'cloud',
    account: { accountId: 'account-a' },
    sessionExpiresAt: 1_000
  } as MobileSession
  const sessionRef: { current: MobileSession | null } = { current: session }
  const directoryStore = new AccountRuntimeDirectoryStore()
  directoryStore.activate({ authorityId: 'cloud', accountId: 'account-a' })
  let profile!: HostProfile
  function Harness() {
    const createProfile = useAccountRuntimeCloudProfile({
      pendingDisplayNames: new Map(),
      directoryStore,
      sessionRef,
      withCurrentSession: (operation) => operation(sessionRef.current!)
    })
    const entry = {
      runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      resourceVersion: 1,
      presence: 'ONLINE',
      readiness: 'READY',
      clientAuthMode: 'IDENTITY_PROOF',
      credentialState: 'ACTIVE',
      connectionCapabilities: ['hive-relay'],
      claimedAt: '2026-09-01T00:00:00Z'
    } as AccountRuntimeDirectoryEntry
    directoryStore.complete(directoryStore.getSnapshot().generation, [entry], 0)
    profile = createProfile(entry)!
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
  return { session, sessionRef, directoryStore, profile }
}

let renderer: ReactTestRenderer
beforeEach(() => vi.clearAllMocks())
afterEach(async () => {
  await act(async () => renderer?.unmount())
})

it('fences a late material response and rejects a stale profile after account replacement', async () => {
  const { session, sessionRef, profile } = await setup()
  const material = {
    outer: { clientAdmissionToken: 'admission' },
    inner: { ticketSecret: new Uint8Array(32).fill(7) },
    clientKeyPair: { secretKey: new Uint8Array(32).fill(9) }
  } as HiveAccountRelayMaterial
  let resolve!: (value: HiveAccountRelayMaterial) => void
  createConnection.mockReturnValueOnce(
    new Promise((settle) => {
      resolve = settle
    })
  )
  const pending = profile.accountRuntime!.createConnection()
  sessionRef.current = { ...session, sessionExpiresAt: 2_000 }
  resolve(material)
  await expect(pending).rejects.toThrow('mobile_session_required')
  expect(material.inner.ticketSecret.every((value) => value === 0)).toBe(true)
  expect(material.clientKeyPair.secretKey.every((value) => value === 0)).toBe(true)
  expect(material.outer.clientAdmissionToken).toBe('')
  await expect(profile.accountRuntime!.createConnection()).rejects.toThrow(
    'mobile_session_required'
  )
  expect(createConnection).toHaveBeenCalledOnce()
})

const conflict = () => new MobileApiError('conflict', 409, undefined, false)

it('uses the latest directory version and refreshes a conflict only once', async () => {
  const { profile, directoryStore } = await setup()
  const snapshot = directoryStore.getSnapshot()
  const entry = { ...snapshot.entries[0]!, resourceVersion: 2 }
  directoryStore.complete(snapshot.generation, [entry], 1)
  const material = {} as HiveAccountRelayMaterial
  createConnection.mockRejectedValueOnce(conflict()).mockResolvedValue(material)
  loadDirectory.mockResolvedValue([{ ...entry, resourceVersion: 3 }])
  await expect(profile.accountRuntime!.createConnection()).resolves.toBe(material)
  expect(createConnection.mock.calls.map((call) => call[2])).toEqual([2, 3])
  await expect(profile.accountRuntime!.createConnection()).resolves.toBe(material)
  expect(createConnection.mock.calls.map((call) => call[2])).toEqual([2, 3, 3])
  expect(loadDirectory).toHaveBeenCalledOnce()
})

it('does not repeatedly retry a conflict or refresh authentication failures', async () => {
  const { profile, directoryStore } = await setup()
  loadDirectory.mockResolvedValue(directoryStore.getSnapshot().entries)
  createConnection.mockRejectedValue(conflict())
  await expect(profile.accountRuntime!.createConnection()).rejects.toMatchObject({ status: 409 })
  expect(createConnection).toHaveBeenCalledTimes(2)
  expect(loadDirectory).toHaveBeenCalledOnce()
  createConnection.mockRejectedValue(new MobileApiError('forbidden', 403, undefined, false))
  await expect(profile.accountRuntime!.createConnection()).rejects.toMatchObject({ status: 403 })
  expect(loadDirectory).toHaveBeenCalledOnce()
})

it.each(['removed', 'revoked', 'session-replaced', 'cancelled'])(
  'does not issue another intent when refresh finds %s',
  async (reason) => {
    const { profile, directoryStore, sessionRef, session } = await setup()
    const controller = new AbortController()
    createConnection.mockRejectedValueOnce(conflict())
    loadDirectory.mockImplementationOnce(async () => {
      if (reason === 'session-replaced') {
        sessionRef.current = { ...session, sessionExpiresAt: 2_000 }
      }
      if (reason === 'cancelled') {
        controller.abort()
      }
      return reason === 'removed'
        ? []
        : directoryStore.getSnapshot().entries.map((entry) => ({
            ...entry,
            credentialState: reason === 'revoked' ? 'REVOKED' : entry.credentialState
          }))
    })
    await expect(profile.accountRuntime!.createConnection(controller.signal)).rejects.toThrow()
    expect(createConnection).toHaveBeenCalledOnce()
  }
)
