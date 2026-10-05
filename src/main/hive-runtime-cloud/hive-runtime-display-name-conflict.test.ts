import { describe, expect, it, vi } from 'vitest'
import { mergeHiveAccountRuntimeCatalog } from './hive-runtime-catalog'
import type { RuntimeDisplayNameClient } from './hive-runtime-display-name-submission'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-http-client'
import { HiveRuntimeDisplayNameCoordinator } from './hive-runtime-display-name-coordinator'
import { reconcileDesktopRuntimeDisplayNames } from './hive-runtime-display-name-reconcile'
import type {
  DesktopPendingDisplayNameState,
  DesktopPendingRuntimeDisplayName
} from './hive-runtime-display-name-pending-store'

const runtimeRecordId = '123e4567-e89b-42d3-a456-426614174000'
const authorization: HiveRuntimeCloudAuthorization = {
  authorityId: 'hive-primary',
  accountId: '223e4567-e89b-42d3-a456-426614174000',
  accessToken: 'fixture-token',
  sessionGeneration: 1,
  sessionExpiresAt: 10_000
}

describe('cloud alias concurrency and ownership boundaries', () => {
  it.each(['CONFLICT', 'UNCONFIRMED'] as const)(
    'preserves the latest cloud value for %s when a late lower-version read equals the draft',
    (status) => {
      const original = task({
        status,
        latestCloudDisplayName: 'Newest',
        latestCloudDisplayNameVersion: 9
      })
      const result = reconcileDesktopRuntimeDisplayNames([original], authorization, [
        directory({ cloudDisplayName: 'Offline draft', cloudDisplayNameVersion: 2 })
      ])
      expect(result).toEqual([original])
    }
  )

  it('reads a 409 once and retains the draft without automatically overwriting the cloud name', async () => {
    const fixture = coordinatorFixture(
      vi
        .fn()
        .mockRejectedValueOnce(new HiveRuntimeCloudRequestError(409, null))
        .mockResolvedValue({ ownershipEpoch: 1, cloudDisplayNameVersion: 3 }),
      directory({ cloudDisplayName: 'Web rename', cloudDisplayNameVersion: 2 })
    )
    fixture.enqueue()
    await vi.waitFor(() => expect(fixture.client.getOwnedRuntime).toHaveBeenCalledTimes(2))
    await fixture.coordinator.retry()

    expect(fixture.client.updateOwnedRuntimeDisplayName).toHaveBeenCalledOnce()
    expect(fixture.tasks()[0]).toMatchObject({
      desiredName: 'Offline draft',
      expectedOwnershipEpoch: 1,
      expectedCloudDisplayNameVersion: 1,
      status: 'CONFLICT',
      latestCloudDisplayName: 'Web rename',
      latestCloudDisplayNameVersion: 2
    })
  })

  it('never rebases a draft on a directory refresh before a write is attempted', () => {
    const result = reconcileDesktopRuntimeDisplayNames([task()], authorization, [
      directory({ cloudDisplayName: 'Other writer', cloudDisplayNameVersion: 2 })
    ])
    expect(result[0]).toMatchObject({
      status: 'CONFLICT',
      expectedOwnershipEpoch: 1,
      expectedCloudDisplayNameVersion: 1,
      desiredName: 'Offline draft'
    })
  })

  it('preserves a confirmed receipt through a resource update within the same ownership epoch', () => {
    const result = reconcileDesktopRuntimeDisplayNames(
      [task({ status: 'CONFIRMED', confirmedCloudDisplayNameVersion: 4 })],
      authorization,
      [directory({ resourceVersion: 2, cloudDisplayNameVersion: 3 })]
    )
    expect(result[0]).toMatchObject({ status: 'CONFIRMED', expectedOwnershipEpoch: 1 })
  })

  it('blocks a reclaimed target before considering an equal null name', () => {
    const result = reconcileDesktopRuntimeDisplayNames(
      [
        task({
          desiredName: null,
          latestCloudDisplayNameVersion: 9,
          latestCloudDisplayName: 'Newest'
        })
      ],
      authorization,
      [directory({ ownershipEpoch: 2, cloudDisplayName: null, cloudDisplayNameVersion: 3 })]
    )
    expect(result[0]).toMatchObject({
      status: 'BLOCKED',
      errorCode: 'OWNERSHIP_CHANGED',
      expectedOwnershipEpoch: 1,
      desiredName: null
    })
  })

  it('does not confirm a successful same-name receipt from a different ownership epoch', async () => {
    const fixture = coordinatorFixture(
      vi.fn().mockResolvedValue({ ownershipEpoch: 2, cloudDisplayNameVersion: 4 })
    )
    fixture.enqueue()
    await fixture.coordinator.retry()
    expect(fixture.tasks()[0]).toMatchObject({
      status: 'BLOCKED',
      errorCode: 'OWNERSHIP_CHANGED',
      expectedOwnershipEpoch: 1
    })
  })

  it('keeps unconfirmed draft and local pairing labels out of a claimed Runtime primary title', () => {
    const pairing = {
      id: 'paired',
      name: 'Local note',
      runtimeRecordId,
      runtimeId: null,
      createdAt: 1,
      updatedAt: 1,
      lastUsedAt: null,
      endpoints: [],
      preferredEndpointId: 'paired'
    }
    const pending = new Map([[runtimeRecordId, task()]])
    expect(
      mergeHiveAccountRuntimeCatalog(
        [pairing],
        [directory({ cloudDisplayName: 'Cloud name' })],
        pending
      )[0]
    ).toMatchObject({ name: 'Cloud name', localPairedName: 'Local note' })
    expect(
      mergeHiveAccountRuntimeCatalog(
        [pairing],
        [directory({ cloudDisplayName: null, deviceName: 'Device' })],
        pending
      )[0]?.name
    ).toBe('Device')
  })
})

function coordinatorFixture(
  updateOwnedRuntimeDisplayName: RuntimeDisplayNameClient['updateOwnedRuntimeDisplayName'],
  latest = directory()
) {
  let state: DesktopPendingDisplayNameState = { schemaVersion: 2, nextRevision: 1, tasks: [] }
  const client = {
    updateOwnedRuntimeDisplayName,
    getOwnedRuntime: vi.fn().mockResolvedValueOnce(directory()).mockResolvedValue(latest)
  }
  const coordinator = new HiveRuntimeDisplayNameCoordinator(
    {
      load: () => state,
      save: (value) => {
        state = value
      }
    },
    client,
    () => 1_000,
    vi.fn(),
    vi.fn()
  )
  coordinator.setAuthorization(authorization)
  return {
    coordinator,
    client,
    tasks: () => state.tasks,
    enqueue: () =>
      coordinator.enqueue({
        runtimeRecordId,
        desiredName: 'Offline draft',
        expectedOwnershipEpoch: 1,
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
  }
}

function task(
  overrides: Partial<DesktopPendingRuntimeDisplayName> = {}
): DesktopPendingRuntimeDisplayName {
  return {
    authorityId: authorization.authorityId,
    accountId: authorization.accountId,
    runtimeRecordId,
    desiredName: 'Offline draft',
    expectedOwnershipEpoch: 1,
    expectedCloudDisplayNameVersion: 1,
    expectedResourceVersion: 1,
    revision: 1,
    resumeStatus: null,
    retryNotBefore: null,
    confirmedCloudDisplayNameVersion: null,
    status: 'QUEUED',
    errorCode: null,
    latestCloudDisplayName: null,
    latestCloudDisplayNameVersion: null,
    ...overrides
  }
}

function directory(
  overrides: Partial<HiveAccountRuntimeDirectoryEntry> = {}
): HiveAccountRuntimeDirectoryEntry {
  return {
    runtimeRecordId,
    status: 'CLAIMED',
    runtimeVersion: '1.5.0',
    runtimeProtocolVersion: 3,
    capabilities: [],
    resourceVersion: 1,
    ownershipEpoch: 1,
    createdAt: 1,
    updatedAt: 1,
    claimedAt: 1,
    presence: 'ONLINE',
    readiness: 'READY',
    readinessReasonCode: null,
    lastHeartbeatAt: 1,
    observedAt: 1,
    freeDiskBytes: 1,
    clientAuthMode: 'IDENTITY_PROOF',
    credentialState: 'ACTIVE',
    connectionCapabilities: ['hive-relay'],
    cloudDisplayName: 'Old name',
    cloudDisplayNameVersion: 1,
    ...overrides
  }
}
