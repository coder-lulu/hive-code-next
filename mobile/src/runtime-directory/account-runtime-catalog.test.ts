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
  it('deduplicates only on an explicit runtimeRecordId and preserves both routes', () => {
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
        deviceToken: 'local-secret',
        accountRuntimeFallback: accountRuntime
      },
      cloudProfile: { id: claimed.runtimeRecordId }
    })
  })

  it('uses account-scoped pending, cloud, local, reported, then short-id display names', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const claimed = runtime(id, 'Cloud name')
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
    ).toBe('Local name')
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
