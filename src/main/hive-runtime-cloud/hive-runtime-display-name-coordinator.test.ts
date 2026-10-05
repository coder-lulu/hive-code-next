import { describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-http-client'
import { HiveRuntimeDisplayNameCoordinator } from './hive-runtime-display-name-coordinator'
import type { DesktopPendingDisplayNameState } from './hive-runtime-display-name-pending-store'

const RUNTIME_ID = '123e4567-e89b-42d3-a456-426614174000'
const firstAuthorization: HiveRuntimeCloudAuthorization = {
  authorityId: 'hive-primary',
  accountId: '223e4567-e89b-42d3-a456-426614174000',
  accessToken: 'token-a',
  sessionGeneration: 1,
  sessionExpiresAt: 10_000
}
const switchedAuthorization: HiveRuntimeCloudAuthorization = {
  ...firstAuthorization,
  accountId: '323e4567-e89b-42d3-a456-426614174000',
  accessToken: 'token-b',
  sessionGeneration: 2
}

describe('HiveRuntimeDisplayNameCoordinator', () => {
  it('does not issue conflict refetches with an authorization that was replaced in flight', async () => {
    const firstPatch = deferred<{ cloudDisplayNameVersion: number }>()
    const getOwnedRuntime = vi
      .fn()
      .mockResolvedValue(directoryEntry({ cloudDisplayName: 'Previous name' }))
    const fixture = createCoordinator({
      getOwnedRuntime,
      updateOwnedRuntimeDisplayName: vi.fn().mockReturnValue(firstPatch.promise)
    })
    fixture.coordinator.setAuthorization(firstAuthorization)
    fixture.enqueue('Old name')
    await vi.waitFor(() => expect(firstPatchStarted(fixture.client)).toBe(true))

    fixture.coordinator.setAuthorization(switchedAuthorization)
    firstPatch.reject(new HiveRuntimeCloudRequestError(409, null))
    await vi.waitFor(() =>
      expect(fixture.client.updateOwnedRuntimeDisplayName).toHaveBeenCalledOnce()
    )

    expect(getOwnedRuntime).toHaveBeenCalledOnce()
  })

  it('never sends an old desired name after a newer revision is queued during conflict refetch', async () => {
    const directoryRead = deferred<HiveAccountRuntimeDirectoryEntry>()
    const updateOwnedRuntimeDisplayName = vi
      .fn()
      .mockRejectedValueOnce(new HiveRuntimeCloudRequestError(409, null))
      .mockResolvedValueOnce({ ownershipEpoch: 1, cloudDisplayNameVersion: 2 })
    const fixture = createCoordinator({
      getOwnedRuntime: vi.fn().mockReturnValue(directoryRead.promise),
      updateOwnedRuntimeDisplayName
    })
    fixture.coordinator.setAuthorization(firstAuthorization)
    fixture.enqueue('Old name')
    await vi.waitFor(() => expect(fixture.client.getOwnedRuntime).toHaveBeenCalledOnce())

    fixture.enqueue('New name')
    directoryRead.resolve(directoryEntry())
    await vi.waitFor(() => expect(updateOwnedRuntimeDisplayName).toHaveBeenCalledOnce())

    expect(updateOwnedRuntimeDisplayName.mock.calls.map((call) => call[1])).toEqual(['New name'])
  })

  it('blocks and retains a task when a read proves the ownership epoch changed', async () => {
    const updateOwnedRuntimeDisplayName = vi
      .fn()
      .mockRejectedValueOnce(new HiveRuntimeCloudRequestError(409, null))
    const fixture = createCoordinator({
      getOwnedRuntime: vi
        .fn()
        .mockResolvedValue(
          directoryEntry({ resourceVersion: 2, ownershipEpoch: 2, cloudDisplayNameVersion: 9 })
        ),
      updateOwnedRuntimeDisplayName
    })
    fixture.coordinator.setAuthorization(firstAuthorization)
    fixture.enqueue('Offline rename')

    await vi.waitFor(() =>
      expect(fixture.coordinator.getPending()[0]).toMatchObject({
        status: 'BLOCKED',
        errorCode: 'OWNERSHIP_CHANGED'
      })
    )
    expect(updateOwnedRuntimeDisplayName).not.toHaveBeenCalled()
    expect(fixture.requestDirectoryRefresh).toHaveBeenCalledOnce()
  })

  it('preserves the old alias fence when the resource snapshot and ownership epoch change', async () => {
    const updateOwnedRuntimeDisplayName = vi.fn().mockRejectedValue(new Error('offline'))
    const fixture = createCoordinator({
      getOwnedRuntime: vi.fn(),
      updateOwnedRuntimeDisplayName
    })
    fixture.coordinator.setAuthorization(firstAuthorization)
    fixture.enqueue('Offline rename')
    await vi.waitFor(() => expect(updateOwnedRuntimeDisplayName).toHaveBeenCalled())

    fixture.coordinator.reconcileDirectory([
      directoryEntry({ resourceVersion: 2, cloudDisplayNameVersion: 9 })
    ])

    expect(fixture.state().tasks[0]).toMatchObject({
      expectedResourceVersion: 1,
      expectedOwnershipEpoch: 1,
      expectedCloudDisplayNameVersion: 1
    })
  })

  it('keeps a confirmed overlay through stale directory reads and clears it after a competing write', async () => {
    const fixture = createCoordinator({
      getOwnedRuntime: vi.fn(),
      updateOwnedRuntimeDisplayName: vi
        .fn()
        .mockResolvedValue({ ownershipEpoch: 1, cloudDisplayNameVersion: 4 })
    })
    fixture.coordinator.setAuthorization(firstAuthorization)
    fixture.enqueue('Accepted name')
    await vi.waitFor(() =>
      expect(fixture.coordinator.getPending()).toEqual([
        expect.objectContaining({ desiredName: 'Accepted name', status: 'CONFIRMED' })
      ])
    )

    fixture.coordinator.reconcileDirectory([
      directoryEntry({ cloudDisplayName: 'Old name', cloudDisplayNameVersion: 3 })
    ])
    expect(fixture.coordinator.getPending()).toHaveLength(1)

    fixture.coordinator.reconcileDirectory([
      directoryEntry({ cloudDisplayName: 'Other device', cloudDisplayNameVersion: 4 })
    ])
    expect(fixture.coordinator.getPending()).toEqual([])
  })

  it('blocks a confirmed overlay and retains its draft when ownership changes', async () => {
    const fixture = createCoordinator({
      getOwnedRuntime: vi.fn(),
      updateOwnedRuntimeDisplayName: vi
        .fn()
        .mockResolvedValue({ ownershipEpoch: 1, cloudDisplayNameVersion: 4 })
    })
    fixture.coordinator.setAuthorization(firstAuthorization)
    fixture.enqueue('Accepted name')
    await vi.waitFor(() => expect(fixture.coordinator.getPending()[0]?.status).toBe('CONFIRMED'))

    fixture.coordinator.reconcileDirectory([
      directoryEntry({
        resourceVersion: 2,
        ownershipEpoch: 2,
        cloudDisplayName: 'Reclaimed Runtime',
        cloudDisplayNameVersion: 3
      })
    ])

    expect(fixture.coordinator.getPending()[0]).toMatchObject({
      status: 'BLOCKED',
      desiredName: 'Accepted name'
    })
  })

  it('requests one directory refresh for a successful multi-task retry pass', async () => {
    const fixture = createCoordinator(
      {
        getOwnedRuntime: vi.fn(),
        updateOwnedRuntimeDisplayName: vi
          .fn()
          .mockResolvedValue({ ownershipEpoch: 1, cloudDisplayNameVersion: 2 })
      },
      [
        pendingTask('123e4567-e89b-42d3-a456-426614174001', 'First', 1),
        pendingTask('123e4567-e89b-42d3-a456-426614174002', 'Second', 2),
        pendingTask('123e4567-e89b-42d3-a456-426614174003', 'Third', 3)
      ]
    )

    fixture.coordinator.setAuthorization(firstAuthorization)
    await vi.waitFor(() =>
      expect(fixture.coordinator.getPending().every((task) => task.status === 'CONFIRMED')).toBe(
        true
      )
    )

    expect(fixture.client.updateOwnedRuntimeDisplayName).toHaveBeenCalledTimes(3)
    expect(fixture.requestDirectoryRefresh).toHaveBeenCalledOnce()
  })
})

function createCoordinator(
  client: {
    getOwnedRuntime: ReturnType<typeof vi.fn>
    updateOwnedRuntimeDisplayName: ReturnType<typeof vi.fn>
  },
  initialTasks: DesktopPendingDisplayNameState['tasks'] = []
) {
  let state: DesktopPendingDisplayNameState = {
    schemaVersion: 2,
    nextRevision: initialTasks.length + 1,
    tasks: initialTasks
  }
  if (!client.getOwnedRuntime.getMockImplementation()) {
    client.getOwnedRuntime.mockImplementation(async (id: string) =>
      directoryEntry({ runtimeRecordId: id })
    )
  }
  const requestDirectoryRefresh = vi.fn()
  const coordinator = new HiveRuntimeDisplayNameCoordinator(
    {
      load: () => state,
      save: (next) => {
        state = next
      }
    },
    client as unknown as ConstructorParameters<typeof HiveRuntimeDisplayNameCoordinator>[1],
    () => 1_000,
    vi.fn(),
    requestDirectoryRefresh
  )
  return {
    coordinator,
    client,
    requestDirectoryRefresh,
    state: () => state,
    enqueue: (desiredName: string, runtimeRecordId = RUNTIME_ID) =>
      coordinator.enqueue({
        runtimeRecordId,
        desiredName,
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1,
        expectedOwnershipEpoch: 1
      })
  }
}

function pendingTask(
  runtimeRecordId: string,
  desiredName: string,
  revision: number
): DesktopPendingDisplayNameState['tasks'][number] {
  return {
    authorityId: firstAuthorization.authorityId,
    accountId: firstAuthorization.accountId,
    runtimeRecordId,
    desiredName,
    expectedCloudDisplayNameVersion: 1,
    expectedResourceVersion: 1,
    expectedOwnershipEpoch: 1,
    revision,
    status: 'QUEUED',
    errorCode: null,
    resumeStatus: null,
    latestCloudDisplayName: null,
    latestCloudDisplayNameVersion: null,
    retryNotBefore: null,
    confirmedCloudDisplayNameVersion: null
  }
}

function directoryEntry(
  overrides: Partial<HiveAccountRuntimeDirectoryEntry> = {}
): HiveAccountRuntimeDirectoryEntry {
  return {
    runtimeRecordId: RUNTIME_ID,
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

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function firstPatchStarted(client: {
  updateOwnedRuntimeDisplayName: ReturnType<typeof vi.fn>
}): boolean {
  return client.updateOwnedRuntimeDisplayName.mock.calls.length > 0
}
