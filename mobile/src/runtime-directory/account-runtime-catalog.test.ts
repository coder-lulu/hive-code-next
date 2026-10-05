import { describe, expect, it } from 'vitest'
import type { HostCatalogEntry, HostProfile } from '../transport/types'
import {
  hostCatalogEntryHasLocalPairing,
  mergeAccountRuntimeCatalog
} from './account-runtime-catalog'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'

const runtime = (runtimeRecordId: string, cloudDisplayName = 'Workstation') =>
  ({
    runtimeRecordId,
    cloudDisplayName,
    status: 'CLAIMED',
    runtimeVersion: '1.0.0',
    runtimeProtocolVersion: 3,
    capabilities: [],
    resourceVersion: 1,
    createdAt: '2026-08-31T00:00:00Z',
    claimedAt: '2026-08-31T00:00:00Z',
    updatedAt: '2026-08-31T00:00:00Z',
    lastHeartbeatAt: '2026-08-31T00:00:30Z',
    presence: 'ONLINE',
    readiness: 'READY',
    readinessReasonCode: null,
    freeDiskBytes: null,
    connectionCapabilities: []
  }) satisfies AccountRuntimeDirectoryEntry

function local(runtimeRecordId?: string): HostCatalogEntry {
  const profile: HostProfile = {
    id: 'local-host',
    name: 'Workstation',
    endpoint: 'ws://192.168.1.2:3999',
    deviceToken: 'local-secret',
    publicKeyB64: 'local-key',
    lastConnected: 1,
    runtimeRecordId
  }
  return { ...profile, credentialStatus: 'ready', profile }
}

describe('account Runtime catalog merge', () => {
  it('does not present a cloud heartbeat or claim as a mobile connection', () => {
    const claimed = runtime('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(mergeAccountRuntimeCatalog([], [claimed], () => null)[0].lastConnected).toBe(0)
    const profile = { ...local().profile!, lastConnected: 123 }
    expect(mergeAccountRuntimeCatalog([], [claimed], () => profile)[0].lastConnected).toBe(123)
  })

  it('deduplicates only on an explicit runtimeRecordId and preserves local pairing', () => {
    const claimed = runtime('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const accountRuntime = {
      runtimeRecordId: claimed.runtimeRecordId,
      resourceVersion: claimed.resourceVersion,
      createConnection: async () => {
        throw new Error('not used')
      }
    }
    const cloudProfile = {
      ...local(claimed.runtimeRecordId).profile!,
      id: claimed.runtimeRecordId,
      accountRuntime
    }
    const result = mergeAccountRuntimeCatalog(
      [local(claimed.runtimeRecordId)],
      [claimed],
      () => cloudProfile
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'local-host',
      name: 'Workstation',
      accessSources: ['manual-pairing', 'account-claimed'],
      profile: {
        id: 'local-host',
        endpoint: 'ws://192.168.1.2:3999',
        deviceToken: 'local-secret'
      },
      cloudProfile: { id: claimed.runtimeRecordId }
    })
  })

  it('uses account-scoped pending and cloud aliases, then the reported name or short id', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const claimed = { ...runtime(id, 'Cloud name'), deviceName: 'Reported name' }
    const localEntry = local(id)
    localEntry.name = 'Local name'
    localEntry.profile = { ...localEntry.profile!, name: 'Local name' }

    expect(mergeAccountRuntimeCatalog([localEntry], [claimed], () => null)[0]?.name).toBe(
      'Cloud name'
    )
    expect(
      mergeAccountRuntimeCatalog(
        [localEntry],
        [claimed],
        () => null,
        new Map([[id, 'Pending name']])
      )[0]?.name
    ).toBe('Pending name')
    expect(
      mergeAccountRuntimeCatalog([localEntry], [claimed], () => null, new Map([[id, null]]))[0]
        ?.name
    ).toBe('Reported name')
    expect(mergeAccountRuntimeCatalog([localEntry], [], () => null)[0]?.name).toBe('Local name')

    const reported = { ...runtime(id, undefined), cloudDisplayName: undefined, deviceName: 'Desk' }
    expect(mergeAccountRuntimeCatalog([], [reported], () => null)[0]?.name).toBe('Desk')
    expect(
      mergeAccountRuntimeCatalog([], [{ ...reported, deviceName: null }], () => null)[0]?.name
    ).toBe('Runtime aaaaaaaa')
  })

  it('does not infer identity from an equal display name or hostname', () => {
    const claimed = runtime('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    const result = mergeAccountRuntimeCatalog([local()], [claimed], () => null)

    expect(result).toHaveLength(2)
    expect(result.map(({ accessSources }) => accessSources)).toEqual([
      ['manual-pairing'],
      ['account-claimed']
    ])
  })

  it.each([false, true])(
    'keeps pending alias names consistent with connection profiles when locally paired=%s',
    (locallyPaired) => {
      const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      const claimed = { ...runtime(id, 'Cloud name'), deviceName: 'Reported name' }
      const localEntry = local(id)
      const cloudProfile: HostProfile = {
        ...localEntry.profile!,
        id,
        name: 'Cloud name',
        endpoint: `cloud://${id}`,
        deviceToken: '',
        publicKeyB64: '',
        accountRuntime: {
          runtimeRecordId: id,
          resourceVersion: claimed.resourceVersion,
          createConnection: async () => {
            throw new Error('not used')
          }
        }
      }
      for (const desiredName of ['Pending name', null]) {
        const [entry] = mergeAccountRuntimeCatalog(
          locallyPaired ? [localEntry] : [],
          [claimed],
          () => cloudProfile,
          new Map([[id, desiredName]])
        )
        const expectedName = desiredName ?? 'Reported name'
        expect(entry.name).toBe(expectedName)
        expect(entry.profile?.name).toBe(expectedName)
        expect(entry.cloudProfile?.name).toBe(expectedName)
        expect(entry.profile?.deviceToken).toBe(locallyPaired ? 'local-secret' : '')
        expect(entry.profile?.endpoint).toBe(locallyPaired ? localEntry.endpoint : `cloud://${id}`)
        expect(entry.profile?.accountRuntime).toEqual(
          locallyPaired ? undefined : cloudProfile.accountRuntime
        )
        expect(localEntry.profile?.name).toBe('Workstation')
        expect(cloudProfile.name).toBe('Cloud name')
      }
    }
  )
})

describe('hostCatalogEntryHasLocalPairing', () => {
  it('permits legacy and explicit local rows but rejects account-only rows', () => {
    expect(hostCatalogEntryHasLocalPairing({})).toBe(true)
    expect(hostCatalogEntryHasLocalPairing({ accessSources: ['manual-pairing'] })).toBe(true)
    expect(
      hostCatalogEntryHasLocalPairing({
        accessSources: ['manual-pairing', 'account-claimed']
      })
    ).toBe(true)
    expect(hostCatalogEntryHasLocalPairing({ accessSources: ['account-claimed'] })).toBe(false)
  })
})
