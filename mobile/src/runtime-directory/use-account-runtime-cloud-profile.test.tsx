import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
const createConnection = vi.hoisted(() => vi.fn())
vi.mock('./account-runtime-directory-client', () => ({
  createAccountRuntimeConnectionIntent: createConnection
}))
import type { MobileSession } from '../auth/mobile-sms-auth'
import type { HostProfile } from '../transport/types'
import type { HiveAccountRelayMaterial } from '../../../src/shared/hive-account-relay-material'
import { AccountRuntimeDirectoryStore } from './account-runtime-directory-store'
import { useAccountRuntimeCloudProfile } from './use-account-runtime-cloud-profile'

it('fences a late material response and rejects a stale profile after account replacement', async () => {
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
    profile = createProfile({
      runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      resourceVersion: 1,
      presence: 'ONLINE',
      readiness: 'READY',
      clientAuthMode: 'IDENTITY_PROOF',
      credentialState: 'ACTIVE',
      connectionCapabilities: ['hive-relay'],
      claimedAt: '2026-09-01T00:00:00Z'
    } as never)!
    return null
  }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(Harness))
  })
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
  await act(async () => renderer.unmount())
})
