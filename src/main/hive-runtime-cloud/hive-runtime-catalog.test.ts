import { describe, expect, it } from 'vitest'
import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveRuntimePendingDisplayName
} from '../../shared/hive-runtime-cloud'
import type { PublicKnownRuntimeEnvironment } from '../../shared/runtime-environments'
import {
  accountRuntimeEnvironmentId,
  mergeHiveAccountRuntimeCatalog,
  resolveHiveRuntimeCatalogEntry,
  runtimeRecordIdFromAccountEnvironmentId
} from './hive-runtime-catalog'

const runtimeRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function local(
  overrides: Partial<PublicKnownRuntimeEnvironment> = {}
): PublicKnownRuntimeEnvironment {
  return {
    id: 'local-pairing-id',
    name: 'Workstation',
    createdAt: 1,
    updatedAt: 2,
    lastUsedAt: null,
    runtimeId: 'runtime-installation-id',
    endpoints: [{ id: 'ws-1', kind: 'websocket', label: 'LAN', endpoint: 'ws://lan' }],
    preferredEndpointId: 'ws-1',
    ...overrides
  }
}

function account(
  overrides: Partial<HiveAccountRuntimeDirectoryEntry> = {}
): HiveAccountRuntimeDirectoryEntry {
  return {
    runtimeRecordId,
    status: 'CLAIMED',
    runtimeVersion: '1.0.0',
    runtimeProtocolVersion: 3,
    capabilities: [],
    resourceVersion: 7,
    ownershipEpoch: 1,
    cloudDisplayName: null,
    cloudDisplayNameVersion: 1,
    createdAt: 10,
    updatedAt: 20,
    claimedAt: 12,
    presence: 'ONLINE',
    readiness: 'READY',
    readinessReasonCode: null,
    lastHeartbeatAt: 19,
    observedAt: 20,
    freeDiskBytes: 1024,
    clientAuthMode: 'IDENTITY_PROOF',
    credentialState: 'ACTIVE',
    connectionCapabilities: ['hive-relay'],
    ...overrides
  }
}

describe('mergeHiveAccountRuntimeCatalog', () => {
  it('merges only an explicit runtimeRecordId and preserves local transport as primary', () => {
    const result = mergeHiveAccountRuntimeCatalog([local({ runtimeRecordId })], [account()])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'local-pairing-id',
      accessSources: ['local-pairing', 'account-claimed'],
      endpoints: [{ endpoint: 'ws://lan' }],
      accountClaim: { runtimeRecordId, cloudConnectable: true }
    })
  })

  it('projects only confirmed account-scoped names and preserves the local pairing label as a note', () => {
    const localEntry = local({ runtimeRecordId, name: 'Local name' })
    const claimed = account({ cloudDisplayName: 'Cloud name', deviceName: 'Reported device' })

    expect(mergeHiveAccountRuntimeCatalog([localEntry], [claimed])[0]?.name).toBe('Cloud name')
    const task: HiveRuntimePendingDisplayName = {
      runtimeRecordId,
      desiredName: 'Pending name',
      revision: 1,
      expectedOwnershipEpoch: 1,
      expectedCloudDisplayNameVersion: 1,
      status: 'QUEUED',
      errorCode: null,
      latestCloudDisplayName: null,
      latestCloudDisplayNameVersion: null,
      confirmedCloudDisplayNameVersion: null,
      retryNotBefore: null
    }
    expect(
      mergeHiveAccountRuntimeCatalog([localEntry], [claimed], new Map([[runtimeRecordId, task]]))[0]
    ).toMatchObject({ name: 'Cloud name', localPairedName: 'Local name' })
    const confirmed = { ...task, status: 'CONFIRMED' as const, confirmedCloudDisplayNameVersion: 2 }
    expect(
      mergeHiveAccountRuntimeCatalog(
        [localEntry],
        [claimed],
        new Map([[runtimeRecordId, confirmed]])
      )[0]?.name
    ).toBe('Pending name')
    expect(
      mergeHiveAccountRuntimeCatalog(
        [localEntry],
        [claimed],
        new Map([[runtimeRecordId, { ...confirmed, desiredName: null }]])
      )[0]?.name
    ).toBe('Reported device')
    expect(mergeHiveAccountRuntimeCatalog([localEntry], [])[0]?.name).toBe('Local name')
  })

  it('falls back from cloud alias to reported device name and short id', () => {
    expect(
      mergeHiveAccountRuntimeCatalog([], [account({ deviceName: 'Reported device' })])[0]?.name
    ).toBe('Reported device')
    expect(mergeHiveAccountRuntimeCatalog([], [account()])[0]?.name).toBe('Runtime aaaaaaaa')
  })

  it('does not merge matching names without an explicit Runtime record id', () => {
    const result = mergeHiveAccountRuntimeCatalog([local()], [account()])

    expect(result).toHaveLength(2)
    expect(result[0]?.accessSources).toEqual(['local-pairing'])
    expect(result[1]?.id).toBe(accountRuntimeEnvironmentId(runtimeRecordId))
  })

  it('keeps an offline account Runtime visible but not cloud-connectable', () => {
    const result = mergeHiveAccountRuntimeCatalog([], [account({ presence: 'OFFLINE' })])

    expect(result[0]?.accountClaim).toMatchObject({ presence: 'OFFLINE', cloudConnectable: false })
    expect(result[0]?.endpoints[0]?.endpoint).toBe(`cloud://${runtimeRecordId}`)
    expect(result[0]?.endpoints[0]?.label).toBe('HiveCloud Relay')
  })

  it.each([
    ['degraded presence', { presence: 'DEGRADED' as const }],
    ['non-ready Runtime', { readiness: 'RECOVERING' as const }],
    ['mTLS client auth', { clientAuthMode: 'MTLS' as const }],
    ['expired credential', { credentialState: 'EXPIRED' as const }],
    ['direct-only capability', { connectionCapabilities: ['hive-direct'] }]
  ])('fails closed for %s while keeping the directory row visible', (_case, override) => {
    const result = mergeHiveAccountRuntimeCatalog([], [account(override)])

    expect(result).toHaveLength(1)
    expect(result[0]?.accountClaim?.cloudConnectable).toBe(false)
  })

  it('does not describe a direct-only account Runtime as a cloud Relay', () => {
    const result = mergeHiveAccountRuntimeCatalog(
      [],
      [account({ connectionCapabilities: ['orca-direct'] })]
    )

    expect(result[0]?.endpoints[0]?.label).toBe('HiveCloud Runtime')
    expect(result[0]?.accountClaim?.cloudConnectable).toBe(false)
  })

  it('round trips the reserved account environment id prefix', () => {
    const id = accountRuntimeEnvironmentId(runtimeRecordId)
    expect(runtimeRecordIdFromAccountEnvironmentId(id)).toBe(runtimeRecordId)
    expect(runtimeRecordIdFromAccountEnvironmentId(runtimeRecordId)).toBeNull()
  })

  it('never resolves a cloud display name as an operational selector', () => {
    const claimed = account({ cloudDisplayName: 'Family computer' })

    expect(() =>
      resolveHiveRuntimeCatalogEntry([], [claimed], new Map(), 'Family computer')
    ).toThrow('Unknown Runtime environment')
    expect(
      resolveHiveRuntimeCatalogEntry(
        [],
        [claimed],
        new Map(),
        accountRuntimeEnvironmentId(runtimeRecordId)
      ).runtimeRecordId
    ).toBe(runtimeRecordId)
    expect(
      resolveHiveRuntimeCatalogEntry([], [claimed], new Map(), runtimeRecordId).runtimeRecordId
    ).toBe(runtimeRecordId)
  })

  it('keeps persisted local names selectable after a cloud alias changes presentation', () => {
    const localEntry = local({ runtimeRecordId, name: 'LAN workstation' })
    const resolved = resolveHiveRuntimeCatalogEntry(
      [localEntry],
      [account({ cloudDisplayName: 'Family computer' })],
      new Map(),
      'LAN workstation'
    )

    expect(resolved.id).toBe(localEntry.id)
    expect(resolved.name).toBe('Family computer')
  })
})
