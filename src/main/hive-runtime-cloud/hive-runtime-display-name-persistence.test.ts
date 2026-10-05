import { describe, expect, it, vi } from 'vitest'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { HiveRuntimeDisplayNameCoordinator } from './hive-runtime-display-name-coordinator'
import type { DesktopPendingDisplayNameState } from './hive-runtime-display-name-pending-store'

const runtimeRecordId = '123e4567-e89b-42d3-a456-426614174000'
const authorization: HiveRuntimeCloudAuthorization = {
  authorityId: 'hive-primary',
  accountId: '223e4567-e89b-42d3-a456-426614174000',
  accessToken: 'fixture-token',
  sessionGeneration: 1,
  sessionExpiresAt: 100_000
}

describe('Runtime alias persistence during verification', () => {
  it.each(['unchanged', 'stale', 'unavailable'] as const)(
    'does not rewrite or publish a settled draft when a read is %s',
    async (scenario) => {
      const fixture = createFixture()
      if (scenario === 'unavailable') {
        fixture.client.getOwnedRuntime.mockRejectedValue(new Error('offline'))
      } else if (scenario === 'stale') {
        fixture.client.getOwnedRuntime.mockResolvedValue(
          directoryEntry({ cloudDisplayName: 'Older name', cloudDisplayNameVersion: 1 })
        )
      }
      await settleAuthorization(fixture)
      const pending = fixture.coordinator.getPending()

      for (let attempt = 0; attempt < 3; attempt++) {
        await fixture.coordinator.retry()
      }

      expect(fixture.client.getOwnedRuntime).toHaveBeenCalledTimes(3)
      expect(fixture.client.updateOwnedRuntimeDisplayName).not.toHaveBeenCalled()
      expect(fixture.save).not.toHaveBeenCalled()
      expect(fixture.onChanged).not.toHaveBeenCalled()
      expect(fixture.coordinator.getPending()).toEqual(pending)
    }
  )

  it('persists a newly observed conflict and an explicit discard', async () => {
    const fixture = createFixture()
    await settleAuthorization(fixture)
    fixture.client.getOwnedRuntime.mockResolvedValue(
      directoryEntry({ cloudDisplayName: 'Another device', cloudDisplayNameVersion: 3 })
    )

    await fixture.coordinator.retry()

    expect(fixture.save).toHaveBeenCalledOnce()
    expect(fixture.onChanged).toHaveBeenCalledOnce()
    expect(fixture.coordinator.getPending()[0]).toMatchObject({
      status: 'CONFLICT',
      errorCode: 'VERSION_CONFLICT',
      latestCloudDisplayName: 'Another device',
      latestCloudDisplayNameVersion: 3
    })
    expect(fixture.client.updateOwnedRuntimeDisplayName).not.toHaveBeenCalled()

    fixture.coordinator.discard({ runtimeRecordId, revision: 1 })

    expect(fixture.save).toHaveBeenCalledTimes(2)
    expect(fixture.onChanged).toHaveBeenCalledTimes(2)
    expect(fixture.coordinator.getPending()).toEqual([])
  })

  it('persists recovery from a failed read, confirmation, and directory acknowledgment', async () => {
    const fixture = createFixture()
    fixture.client.getOwnedRuntime.mockRejectedValue(new Error('offline'))
    await settleAuthorization(fixture)
    const accepted = directoryEntry({ cloudDisplayName: 'My draft' })
    fixture.client.getOwnedRuntime.mockResolvedValue(accepted)

    await fixture.coordinator.retry()

    expect(fixture.save).toHaveBeenCalledOnce()
    expect(fixture.onChanged).toHaveBeenCalledOnce()
    expect(fixture.coordinator.getPending()[0]).toMatchObject({
      status: 'CONFIRMED',
      errorCode: null,
      confirmedCloudDisplayNameVersion: 2
    })
    expect(fixture.requestDirectoryRefresh).toHaveBeenCalledOnce()
    expect(fixture.client.updateOwnedRuntimeDisplayName).not.toHaveBeenCalled()

    fixture.coordinator.reconcileDirectory([accepted])
    await fixture.coordinator.retry()

    expect(fixture.save).toHaveBeenCalledTimes(2)
    expect(fixture.onChanged).toHaveBeenCalledTimes(2)
    expect(fixture.coordinator.getPending()).toEqual([])
  })
})

async function settleAuthorization(fixture: ReturnType<typeof createFixture>): Promise<void> {
  fixture.coordinator.setAuthorization(authorization)
  await fixture.coordinator.retry()
  fixture.save.mockClear()
  fixture.onChanged.mockClear()
  fixture.client.getOwnedRuntime.mockClear()
}

function createFixture() {
  let state: DesktopPendingDisplayNameState = {
    schemaVersion: 2,
    nextRevision: 2,
    tasks: [
      {
        authorityId: authorization.authorityId,
        accountId: authorization.accountId,
        runtimeRecordId,
        desiredName: 'My draft',
        revision: 1,
        expectedOwnershipEpoch: 1,
        expectedResourceVersion: 1,
        expectedCloudDisplayNameVersion: 2,
        status: 'UNCONFIRMED',
        errorCode: 'RESULT_UNKNOWN',
        resumeStatus: null,
        latestCloudDisplayName: 'Old name',
        latestCloudDisplayNameVersion: 2,
        confirmedCloudDisplayNameVersion: null,
        retryNotBefore: null
      }
    ]
  }
  const client = {
    getOwnedRuntime: vi.fn().mockResolvedValue(directoryEntry()),
    updateOwnedRuntimeDisplayName: vi.fn()
  }
  const save = vi.fn((next: DesktopPendingDisplayNameState) => {
    state = next
  })
  const onChanged = vi.fn()
  const requestDirectoryRefresh = vi.fn()
  const coordinator = new HiveRuntimeDisplayNameCoordinator(
    { load: () => state, save },
    client,
    () => 1_000,
    onChanged,
    requestDirectoryRefresh
  )
  return { coordinator, client, save, onChanged, requestDirectoryRefresh }
}

function directoryEntry(
  overrides: Partial<HiveAccountRuntimeDirectoryEntry> = {}
): HiveAccountRuntimeDirectoryEntry {
  return {
    runtimeRecordId,
    status: 'CLAIMED',
    runtimeVersion: '1.5',
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
    freeDiskBytes: null,
    clientAuthMode: 'IDENTITY_PROOF',
    credentialState: 'ACTIVE',
    connectionCapabilities: ['hive-relay'],
    cloudDisplayName: 'Old name',
    cloudDisplayNameVersion: 2,
    ...overrides
  }
}
