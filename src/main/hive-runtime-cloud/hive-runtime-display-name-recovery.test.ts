import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { HiveRuntimeDisplayNameCoordinator } from './hive-runtime-display-name-coordinator'
import {
  HiveRuntimeDisplayNamePendingStore,
  type DesktopPendingDisplayNameState,
  type DesktopPendingRuntimeDisplayName
} from './hive-runtime-display-name-pending-store'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-http-client'
import { reconcileDesktopRuntimeDisplayNames } from './hive-runtime-display-name-reconcile'

const runtimeRecordId = '123e4567-e89b-42d3-a456-426614174000'
const authorization: HiveRuntimeCloudAuthorization = {
  authorityId: 'hive-primary',
  accountId: '223e4567-e89b-42d3-a456-426614174000',
  accessToken: 'fixture-token',
  sessionGeneration: 1,
  sessionExpiresAt: 100_000
}
const temporaryDirectories: string[] = []
afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
function storeFixture() {
  const log = resolve('logs/runtime-cloud-alias-development-20261003')
  mkdirSync(log, { recursive: true })
  const root = mkdtempSync(join(log, 'queue-fixture-'))
  temporaryDirectories.push(root)
  const path = join(root, 'hive-runtime-cloud', 'display-name-pending.v1.json')
  mkdirSync(join(root, 'hive-runtime-cloud'))
  return { path, store: new HiveRuntimeDisplayNamePendingStore(root) }
}
function task(
  overrides: Partial<DesktopPendingRuntimeDisplayName> = {}
): DesktopPendingRuntimeDisplayName {
  return {
    authorityId: authorization.authorityId,
    accountId: authorization.accountId,
    runtimeRecordId,
    desiredName: 'My draft',
    revision: 1,
    expectedOwnershipEpoch: 1,
    expectedResourceVersion: 1,
    expectedCloudDisplayNameVersion: 1,
    status: 'QUEUED',
    errorCode: null,
    resumeStatus: null,
    latestCloudDisplayName: null,
    latestCloudDisplayNameVersion: null,
    confirmedCloudDisplayNameVersion: null,
    retryNotBefore: null,
    ...overrides
  }
}
function entry(
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
    cloudDisplayName: 'Cloud name',
    cloudDisplayNameVersion: 1,
    ...overrides
  }
}
function memoryCoordinator(initial = task()) {
  let state: DesktopPendingDisplayNameState = {
    schemaVersion: 2,
    nextRevision: 2,
    tasks: [initial]
  }
  const client = {
    getOwnedRuntime: vi.fn().mockResolvedValue(entry()),
    updateOwnedRuntimeDisplayName: vi.fn().mockRejectedValue(new Error('response lost'))
  }
  const coordinator = new HiveRuntimeDisplayNameCoordinator(
    {
      load: () => state,
      save: (next) => {
        state = next
      }
    },
    client,
    () => 1_000,
    vi.fn(),
    vi.fn()
  )
  coordinator.setAuthorization(authorization)
  return { coordinator, client, tasks: () => state.tasks }
}

describe('durable Runtime alias recovery', () => {
  it('backs up legacy drafts, blocks their unknown original ownership, and binds only an explicitly new task', async () => {
    const fixture = storeFixture()
    const oldTask = {
      authorityId: authorization.authorityId,
      accountId: authorization.accountId,
      runtimeRecordId,
      desiredName: 'My draft',
      revision: 1,
      expectedResourceVersion: 1,
      expectedCloudDisplayNameVersion: 1,
      dormant: false,
      confirmed: false,
      confirmedCloudDisplayNameVersion: null
    }
    const oldState = { schemaVersion: 1, nextRevision: 2, tasks: [oldTask] }
    writeFileSync(fixture.path, JSON.stringify(oldState))
    expect(fixture.store.load().tasks[0]).toMatchObject({
      desiredName: 'My draft',
      status: 'BLOCKED',
      errorCode: 'OWNERSHIP_UNVERIFIED',
      expectedOwnershipEpoch: null
    })
    expect(JSON.parse(readFileSync(`${fixture.path}.before-ownership-epoch.json`, 'utf8'))).toEqual(
      oldState
    )
    const client = {
      getOwnedRuntime: vi
        .fn()
        .mockResolvedValue(entry({ ownershipEpoch: 2, cloudDisplayNameVersion: 3 })),
      updateOwnedRuntimeDisplayName: vi
        .fn()
        .mockResolvedValue({ ownershipEpoch: 2, cloudDisplayNameVersion: 4 })
    }
    const coordinator = new HiveRuntimeDisplayNameCoordinator(
      fixture.store,
      client,
      () => 1_000,
      vi.fn(),
      vi.fn()
    )
    coordinator.setAuthorization(authorization)
    await coordinator.retry()
    coordinator.reconcileDirectory([entry({ ownershipEpoch: 2, cloudDisplayNameVersion: 3 })])
    await coordinator.retry()
    expect(client.getOwnedRuntime).not.toHaveBeenCalled()
    expect(client.updateOwnedRuntimeDisplayName).not.toHaveBeenCalled()
    expect(() =>
      coordinator.enqueue({
        runtimeRecordId,
        desiredName: 'My draft',
        expectedOwnershipEpoch: 2,
        expectedCloudDisplayNameVersion: 3,
        expectedResourceVersion: 1
      })
    ).toThrow('draft_stale')
    coordinator.enqueue({
      runtimeRecordId,
      desiredName: 'My draft',
      expectedOwnershipEpoch: 2,
      expectedCloudDisplayNameVersion: 3,
      expectedResourceVersion: 1,
      pendingRevision: 1
    })
    await coordinator.retry()
    expect(client.updateOwnedRuntimeDisplayName).toHaveBeenCalledOnce()
    expect(coordinator.getPending()[0]).toMatchObject({
      revision: 2,
      expectedOwnershipEpoch: 2,
      status: 'CONFIRMED'
    })
  })
  it('does not replace the old file when its migration backup cannot be saved', () => {
    const legacy = {
      schemaVersion: 1,
      nextRevision: 2,
      tasks: [
        {
          authorityId: authorization.authorityId,
          accountId: authorization.accountId,
          runtimeRecordId,
          desiredName: 'My draft',
          revision: 1,
          expectedResourceVersion: 1,
          expectedCloudDisplayNameVersion: 1,
          dormant: false,
          confirmed: false,
          confirmedCloudDisplayNameVersion: null
        }
      ]
    }
    const write = vi.fn().mockReturnValue(false)
    const store = new HiveRuntimeDisplayNamePendingStore(
      'logs/runtime-cloud-alias-development-20261003/unwritten',
      {
        read: (path) =>
          path.endsWith('.before-ownership-epoch.json')
            ? { status: 'missing' }
            : { status: 'ok', value: legacy },
        write
      }
    )
    expect(() => store.load()).toThrow('migration_failed')
    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0]?.[0]).toMatch(/before-ownership-epoch\.json$/)
  })
  it('recovers SUBMITTING as UNCONFIRMED across restart and only reads it', async () => {
    const fixture = storeFixture()
    fixture.store.save({
      schemaVersion: 2,
      nextRevision: 2,
      tasks: [task({ status: 'SUBMITTING' })]
    })
    const recovered = fixture.store.load()
    expect(recovered.tasks[0]).toMatchObject({ status: 'UNCONFIRMED', errorCode: 'RESULT_UNKNOWN' })
    expect(JSON.parse(readFileSync(fixture.path, 'utf8')).tasks[0].status).toBe('UNCONFIRMED')
    const test = memoryCoordinator(recovered.tasks[0])
    await test.coordinator.retry()
    await test.coordinator.retry()
    expect(test.client.getOwnedRuntime).toHaveBeenCalled()
    expect(test.client.updateOwnedRuntimeDisplayName).not.toHaveBeenCalled()
  })
  it('never automatically resends after a write response is lost, including refresh and another retry', async () => {
    const test = memoryCoordinator()
    await test.coordinator.retry()
    expect(test.tasks()[0]).toMatchObject({
      status: 'UNCONFIRMED',
      expectedCloudDisplayNameVersion: 1
    })
    test.coordinator.reconcileDirectory([entry()])
    await test.coordinator.retry()
    expect(test.client.updateOwnedRuntimeDisplayName).toHaveBeenCalledOnce()
    test.client.getOwnedRuntime.mockResolvedValue(
      entry({ cloudDisplayName: 'My draft', cloudDisplayNameVersion: 2 })
    )
    await test.coordinator.retry()
    expect(test.tasks()[0]?.status).toBe('CONFIRMED')
    expect(test.client.updateOwnedRuntimeDisplayName).toHaveBeenCalledOnce()
  })
  it('keeps ownership change blocked even if a later stale snapshot reports the old epoch', () => {
    const changed = reconcileDesktopRuntimeDisplayNames([task()], authorization, [
      entry({ ownershipEpoch: 2 })
    ])
    const stale = reconcileDesktopRuntimeDisplayNames(changed, authorization, [
      entry({ cloudDisplayName: 'My draft' })
    ])
    expect(stale[0]).toMatchObject({
      status: 'BLOCKED',
      errorCode: 'OWNERSHIP_CHANGED',
      expectedOwnershipEpoch: 1
    })
  })
  it('recovers a temporary read block in the same epoch without rebasing the original alias version', () => {
    const result = reconcileDesktopRuntimeDisplayNames(
      [
        task({
          status: 'BLOCKED',
          errorCode: 'READ_UNAVAILABLE',
          resumeStatus: 'QUEUED'
        })
      ],
      authorization,
      [entry({ resourceVersion: 99 })]
    )
    expect(result[0]).toMatchObject({
      status: 'QUEUED',
      expectedOwnershipEpoch: 1,
      expectedResourceVersion: 1,
      expectedCloudDisplayNameVersion: 1
    })
  })
  it('obeys Retry-After without replacing the alias fence or repeatedly writing', async () => {
    const test = memoryCoordinator()
    test.client.updateOwnedRuntimeDisplayName.mockRejectedValue(
      new HiveRuntimeCloudRequestError(429, null, 90_000)
    )
    await test.coordinator.retry()
    await test.coordinator.retry()
    expect(test.tasks()[0]).toMatchObject({
      status: 'QUEUED',
      errorCode: 'RATE_LIMITED',
      retryNotBefore: 91_000,
      expectedCloudDisplayNameVersion: 1
    })
    expect(test.client.updateOwnedRuntimeDisplayName).toHaveBeenCalledOnce()
    test.coordinator.enqueue({
      runtimeRecordId,
      desiredName: 'Edited while limited',
      expectedOwnershipEpoch: 1,
      expectedResourceVersion: 1,
      expectedCloudDisplayNameVersion: 1
    })
    await test.coordinator.retry()
    expect(test.client.updateOwnedRuntimeDisplayName).toHaveBeenCalledOnce()
    expect(test.tasks()[0]).toMatchObject({
      desiredName: 'Edited while limited',
      retryNotBefore: 91_000
    })
  })
})
