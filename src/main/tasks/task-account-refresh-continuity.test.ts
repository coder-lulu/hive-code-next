import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/secret-store', () => ({
  getSecretStore: () => ({
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
    describeProtectionGap: () => null
  })
}))
vi.mock('electron', () => ({ app: { isPackaged: true }, shell: { openExternal: vi.fn() } }))

import { HiveAccountService } from '../hive-account/hive-account-service'
import { HiveAccountClient, HiveAccountRequestError } from '../hive-account/hive-account-client'
import {
  readHiveAccountSession,
  saveHiveAccountSession
} from '../hive-account/hive-account-session-store'
import { LocalRuntimeOwnershipService } from '../hive-runtime-cloud/local-runtime-ownership-service'
import { HiveRuntimeCloudClient } from '../hive-runtime-cloud/hive-runtime-cloud-client'
import { publicKeyDigest } from '../hive-runtime-cloud/hive-runtime-cloud-presence-support'
import type { HiveRuntimeCloudRegistrationState } from '../hive-runtime-cloud/hive-runtime-cloud-state-store'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import {
  fixture as presenceFixture,
  claimedState,
  identity,
  report
} from '../hive-runtime-cloud/hive-runtime-cloud-presence-test-fixture'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { createLocalTaskAuthorizer } from './local-task-authority'
import { TaskExecutionHost } from './task-execution-host'
import { installTaskAuthorizationMonitor } from './task-authorization-monitor'
import {
  editPersistedTestAgentSessionStore,
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStoreText
} from '../runtime/agent-session-record-store-test-harness'
import { taskExecutionRecordKey } from './task-execution-record'
import { addRefreshModelTestTask } from './task-account-refresh-model.test-fixture'
import {
  taskCapabilities,
  taskCommand,
  TASK_TEST_LAUNCH,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

let directory: string
const cleanup: (() => Promise<unknown> | void)[] = []
beforeEach(async () => {
  const root = resolve(
    'logs/paperclip-development/p3/task-authentication-refresh-continuity/writer/tmp'
  )
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'continuity-'))
  vi.spyOn(Date, 'now').mockReturnValue(TASK_TEST_NOW)
})
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) {
    await close()
  }
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})
function token(signature: string, patch: Record<string, unknown> = {}) {
  return `e30.${Buffer.from(
    JSON.stringify({
      sub: claimedState().ownerAccountId,
      authority_id: 'hive-primary',
      session_id: '923e4567-e89b-42d3-a456-426614174000',
      exp: (TASK_TEST_NOW + 600_000) / 1000,
      ...patch
    })
  ).toString('base64url')}.${signature}`
}
const response = (signature: string) => ({
  accessToken: token(signature),
  refreshToken: `offline-refresh-${signature}`,
  expiresAt: TASK_TEST_NOW + 600_000,
  sessionExpiresAt: TASK_TEST_NOW + 1_800_000,
  sessionProfile: 'TRUSTED' as const,
  account: { accountId: claimedState().ownerAccountId, displayName: 'Synthetic offline account' },
  authorityId: 'hive-primary'
})
const ownedRuntime = (runtimeRecordId: string): HiveAccountRuntimeDirectoryEntry => ({
  runtimeRecordId,
  status: 'CLAIMED',
  runtimeVersion: '1.5.0',
  runtimeProtocolVersion: 3,
  capabilities: ['pairing-v3'],
  resourceVersion: 1,
  createdAt: TASK_TEST_NOW,
  updatedAt: TASK_TEST_NOW,
  claimedAt: TASK_TEST_NOW,
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: 'healthy',
  lastHeartbeatAt: TASK_TEST_NOW,
  observedAt: TASK_TEST_NOW,
  freeDiskBytes: 100,
  clientAuthMode: 'IDENTITY_PROOF',
  credentialState: 'ACTIVE',
  connectionCapabilities: ['hive-relay']
})
async function accountFixture() {
  const config = {
    apiBaseUrl: 'https://offline.invalid',
    identityIssuer: 'https://offline.invalid/identity',
    userLoginUrl: 'https://offline.invalid/login',
    clientId: 'hivecode-desktop',
    scope: 'openid'
  }
  const client = new HiveAccountClient(config)
  vi.spyOn(client, 'discoverAuthorizationEndpoint').mockResolvedValue(
    'https://offline.invalid/authorize'
  )
  vi.spyOn(client, 'exchangeSession').mockResolvedValue(response('original'))
  const refresh = vi.spyOn(client, 'refreshSession').mockResolvedValue(response('rotated'))
  vi.spyOn(client, 'listCloudSessions').mockResolvedValue([
    {
      cloudSessionId: '923e4567-e89b-42d3-a456-426614174000',
      securityVersion: 1,
      currentSession: true
    }
  ])
  const revoke = vi.spyOn(client, 'revokeSession').mockResolvedValue(undefined)
  const account = new HiveAccountService(directory, {
    getConfig: () => ({ configured: true, config }),
    createClient: () => client,
    beginAuthorization: async () => ({
      authorizationCode: 'offline-code',
      codeVerifier: 'offline-verifier',
      nonce: 'offline-nonce',
      redirectUri: 'http://127.0.0.1'
    })
  })
  await account.signIn({ sessionProfile: 'TRUSTED' })
  return { account, client, refresh, revoke }
}
async function taskFixture() {
  const a = await accountFixture()
  const presence = presenceFixture(claimedState(), () => 0, Date.now, null)
  cleanup.push(() => presence.service.stop())
  presence.client.heartbeat.mockResolvedValue({
    leaseId: '823e4567-e89b-42d3-a456-426614174000',
    authorityGeneration: 1,
    leaseEpoch: 1,
    fencingEpoch: 1,
    acceptedHeartbeatSeq: 1,
    observedAt: TASK_TEST_NOW,
    leaseExpiresAt: TASK_TEST_NOW + 90_000,
    presence: 'ONLINE',
    duplicate: false
  })
  presence.service.setAuthorization(a.account.getRuntimeCloudAuthorization())
  presence.service.setRuntimeReady(true)
  await vi.waitFor(() => expect(presence.service.getState()).toBe('ONLINE'))
  let stored: HiveRuntimeCloudRegistrationState = { ...claimedState(), latestLeaseEpoch: 1 }
  let leaseUnavailable = false
  let bootIdChanged = false
  let leaseIdentityChanged = false
  const client = new HiveRuntimeCloudClient('https://offline.invalid')
  vi.spyOn(client, 'getAuthorityId').mockResolvedValue('hive-primary')
  vi.spyOn(client, 'lookup').mockImplementation(async () => ({
    exists: true,
    status: 'CLAIMED',
    runtimeRecordId: stored.runtimeRecordId,
    resourceVersion: stored.resourceVersion,
    authorityGeneration: stored.authorityGeneration,
    fencingEpoch: stored.fencingEpoch,
    latestLeaseEpoch: stored.latestLeaseEpoch,
    identityPublicKeySha256: publicKeyDigest(identity)
  }))
  const owned = vi
    .spyOn(client, 'getOwnedRuntime')
    .mockResolvedValue(ownedRuntime(stored.runtimeRecordId))
  const ownership = new LocalRuntimeOwnershipService({
    config: { enabled: true, apiBaseUrl: 'https://offline.invalid' },
    userDataPath: directory,
    getReport: () => report,
    getBootId: () => (bootIdChanged ? 'changed-offline-boot' : presence.service.getBootId()),
    getCurrentLeaseContext: () => {
      const lease = presence.service.getCurrentLeaseContext()
      return leaseUnavailable
        ? null
        : leaseIdentityChanged && lease
          ? {
              ...lease,
              identity: { ...lease.identity, runtimeInstanceId: 'changed-offline-identity' }
            }
          : lease
    },
    dependencies: {
      createClient: () => client,
      loadIdentity: () => ({ status: 'ok', identity }),
      readState: () => ({ status: 'ok', value: stored }),
      saveState: (_path, state) => {
        if (state.status !== 'CLAIMED') {
          throw new Error('Expected synthetic current claim')
        }
        stored = state
        return true
      },
      clearState: vi.fn(),
      clearIdentity: vi.fn(),
      now: Date.now,
      randomUuid: () => '423e4567-e89b-42d3-a456-426614174000'
    }
  })
  cleanup.push(() => ownership.stop())
  const unsubscribePresence = presence.service.subscribeState((state) =>
    ownership.setPresenceState(state)
  )
  cleanup.push(unsubscribePresence)
  ownership.setAuthorization(a.account.getRuntimeCloudAuthorization())
  await vi.waitFor(() => expect(ownership.getState().relation).toBe('CLAIMED_BY_CURRENT'))
  cleanup.push(
    a.account.subscribeRuntimeCloudAuthorization((auth) => {
      presence.service.setAuthorization(auth)
      ownership.setAuthorization(auth)
    })
  )
  const records = await openTestAgentSessionRecordStore(join(directory, 'records'))
  const currentRuntime = () => {
    const account = a.account.getRuntimeCloudAuthorization(),
      owner = ownership.getState()
    const lease = presence.service.getCurrentLeaseContext()
    return account &&
      lease &&
      owner.relation === 'CLAIMED_BY_CURRENT' &&
      owner.accountId === account.accountId &&
      owner.sessionGeneration === account.sessionGeneration &&
      owner.runtimeRecordId === lease.tuple.runtimeRecordId
      ? {
          accountId: account.accountId,
          runtimeRecordId: lease.tuple.runtimeRecordId,
          ownershipEpoch: lease.tuple.fencingEpoch
        }
      : null
  }
  const path = join(directory, 'source')
  await mkdir(path)
  await writeFile(join(path, 'original.txt'), 'Synthetic offline original Task input')
  const caller = { operationCallerKey: 'trusted-local:refresh-test' }
  const issuer = new LocalTaskBindingIssuer({
    directory: join(directory, 'tasks'),
    ...caller,
    currentAccount: () => a.account.getRuntimeCloudAuthorization(),
    currentRuntime,
    resolveSource: async () => ({ path, assertCurrent: () => undefined }),
    registerWorkspace: async () => ({
      workspaceId: 'folder:offline-task',
      assertCurrent: () => undefined
    }),
    readExecution: (command) => records.tasks.get(command),
    restoreWorkspace: async () => ({ assertCurrent: () => undefined }),
    now: Date.now
  })
  cleanup.push(() => issuer.close())
  const binding = await issuer.issue({
    paperclipCompanyId: 'company:offline',
    paperclipAgentId: 'agent:offline',
    task: { ...taskCommand().task, spaceId: 'company:offline' },
    workspaceSelector: 'id:offline-source',
    input: 'Synthetic offline custody regression'
  })
  const grant = issuer.resolveGrant(binding.command.authorizationRef)!
  const original = (
    await records.tasks.admit({
      command: binding.command,
      ...caller,
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
  ).record
  await records.tasks.beginDispatch(binding.command, TASK_TEST_NOW, grant.assertCurrent)
  await records.tasks.bindLaunch(
    original,
    { ...TASK_TEST_LAUNCH, worktreeId: grant.workspace.workspaceId },
    TASK_TEST_NOW
  )
  const record = records.tasks.get(binding.command)!
  const host = new TaskExecutionHost({
    store: records.tasks,
    authorize: createLocalTaskAuthorizer({
      currentAccount: () => a.account.getRuntimeCloudAuthorization(),
      currentRuntime,
      resolveGrant: issuer.resolveGrant,
      now: Date.now
    }),
    capabilities: () => taskCapabilities(binding.command),
    launch: vi.fn(),
    collect: async () => null,
    stop: async () => null,
    now: Date.now
  })
  const monitor = installTaskAuthorizationMonitor({
    issuer,
    store: records.tasks,
    host: {
      fenceRevokedExecution: (...args) => host.fenceRevokedExecution(...args),
      recoverPersistedExecution: async () => undefined
    },
    ...caller,
    assertCurrent: () => undefined,
    subscribe: (listener) => {
      const account = a.account.subscribeRuntimeCloudAuthorization(listener),
        owner = ownership.subscribe(listener)
      return () => {
        account()
        owner()
      }
    }
  })
  const closeMonitor = () => monitor.close()
  cleanup.push(closeMonitor)
  await monitor.check()
  return {
    ...a,
    presence,
    ownership,
    owned,
    issuer,
    record,
    records,
    monitor,
    host,
    closeMonitor,
    addStructuredTask: (index: number) =>
      addRefreshModelTestTask(issuer, records, binding.command.task, caller, index),
    changeProof: (changed: string) => {
      if (stored.status !== 'CLAIMED') {
        throw new Error('Expected claimed offline tuple')
      }
      if (changed === 'owner-missing') {
        delete stored.ownerAccountId
      } else if (changed === 'owner-changed') {
        stored.ownerAccountId = '323e4567-e89b-42d3-a456-426614174000'
      } else if (changed === 'runtime') {
        stored = { ...stored, runtimeRecordId: '623e4567-e89b-42d3-a456-426614174000' }
      } else if (changed === 'authority') {
        stored.authorityId = 'other-authority'
      } else if (changed === 'fencing') {
        stored = { ...stored, fencingEpoch: stored.fencingEpoch + 1 }
      } else if (changed === 'authority-generation') {
        stored = { ...stored, authorityGeneration: stored.authorityGeneration + 1 }
      } else if (changed === 'lease-epoch') {
        stored = { ...stored, latestLeaseEpoch: stored.latestLeaseEpoch + 1 }
      } else if (changed === 'lease-missing') {
        leaseUnavailable = true
      } else if (changed === 'lease-identity') {
        leaseIdentityChanged = true
      } else if (changed === 'boot') {
        bootIdChanged = true
      }
    }
  }
}

describe('ordinary account refresh and original Task custody', () => {
  it('fences expired accepted Cloud lease during same-login refresh and cannot dispatch its original model effect', async () => {
    const f = await taskFixture(),
      target = await f.addStructuredTask(2)
    const responseBefore = await f.presence.client.heartbeat.mock.results[0].value
    let releaseHeartbeat!: (value: typeof responseBefore) => void
    f.presence.client.heartbeat.mockReturnValueOnce(
      new Promise((resolveHold) => {
        releaseHeartbeat = resolveHold
      })
    )
    f.presence.service.requestHeartbeat()
    await vi.waitFor(() => expect(f.presence.client.heartbeat).toHaveBeenCalledTimes(2))
    let releaseOwner!: (value: HiveAccountRuntimeDirectoryEntry) => void
    f.owned.mockReturnValueOnce(
      new Promise((resolveHold) => {
        releaseOwner = resolveHold
      })
    )
    try {
      vi.spyOn(Date, 'now').mockReturnValue(TASK_TEST_NOW + 90_001)
      expect.soft(f.presence.service.getCurrentLeaseContext()).toBeNull()
      await f.account.refresh()
      await f.monitor.check()
      expect.soft(f.ownership.getState().relation).not.toBe('CLAIMED_BY_CURRENT')
      expect
        .soft(f.records.tasks.get(target.task.command)?.cancellationKey)
        .toBe(`revoked:${target.task.commandFingerprint}`)
      const start = vi.fn(() => 'synthetic effect')
      await expect
        .soft(
          f.records.tasks.runModelEffect(
            target.structured,
            () => f.issuer.assertExecutionCurrent(target.task),
            start
          )
        )
        .rejects.toThrow()
      expect.soft(start).not.toHaveBeenCalled()
    } finally {
      releaseOwner?.(ownedRuntime(f.record.command.runtimeRecordId))
      releaseHeartbeat({ ...responseBefore, acceptedHeartbeatSeq: 2 })
    }
  })
  it('does not fence foreign caller executions or duplicate the first original reason on replay', async () => {
    const f = await taskFixture()
    const command = taskCommand({
      executionId: 'execution:foreign',
      idempotencyKey: 'start:foreign',
      operationId: `${TASK_TEST_NOW}-${'f'.repeat(32)}`,
      workspaceExecutionClaimRef: 'claim:foreign',
      task: { ...taskCommand().task, taskId: 'task:foreign', runId: 'run:foreign' }
    })
    const workspace = join(directory, 'foreign-workspace')
    await f.records.tasks.admit({
      command,
      operationCallerKey: 'foreign:caller',
      now: TASK_TEST_NOW,
      workspace: {
        hostId: 'local',
        workspaceId: 'foreign-workspace',
        canonicalPath: workspace,
        executionPath: workspace,
        isolation: 'managed_copy'
      },
      validate: () => undefined
    })
    await f.account.signOut()
    await f.monitor.check()
    await f.monitor.check()
    await f.monitor.close()
    expect(f.records.tasks.get(command)?.cancellationKey).toBeNull()
    expect(
      f.records.tasks
        .get(f.record.command)
        ?.events.filter((event) => event.summary?.startsWith('Task authorization failure:'))
    ).toHaveLength(1)
  })
  it('refuses stale captured workspace replacement and reports unresolved close without changing that execution', async () => {
    const f = await taskFixture()
    const original = f.host.fenceRevokedExecution.bind(f.host)
    let release!: () => void, started!: () => void
    const held = new Promise<void>((resolveHold) => {
      release = resolveHold
    })
    const ready = new Promise<void>((resolveReady) => {
      started = resolveReady
    })
    vi.spyOn(f.host, 'fenceRevokedExecution').mockImplementation(async (...args) => {
      started()
      await held
      await original(...args)
    })
    const read = f.records.tasks.readActive.bind(f.records.tasks)
    let releaseRead!: () => void, readStarted!: () => void
    const heldRead = new Promise<void>((resolveHold) => {
      releaseRead = resolveHold
    })
    const readReady = new Promise<void>((resolveReady) => {
      readStarted = resolveReady
    })
    vi.spyOn(f.records.tasks, 'readActive').mockImplementationOnce(async (validate) => {
      readStarted()
      await heldRead
      return read(validate)
    })
    const checking = f.monitor.check()
    await readReady
    await f.account.signOut()
    await ready
    const recordDirectory = join(directory, 'records')
    await editPersistedTestAgentSessionStore(recordDirectory, (state) => {
      state.taskExecutions[taskExecutionRecordKey(f.record.command)].workspace.canonicalPath +=
        '-replacement'
    })
    const before = await readPersistedTestAgentSessionStoreText(recordDirectory)
    const closing = f.monitor.close()
    release()
    releaseRead()
    await checking
    await expect(closing).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(await readPersistedTestAgentSessionStoreText(recordDirectory)).toBe(before)
    // The canonical store remains recovery-blocked; close must keep this original unresolved.
    await expect(f.monitor.close()).rejects.toThrow('OUTCOME_UNKNOWN')
    cleanup.splice(cleanup.indexOf(f.closeMonitor), 1)
  })
  it('queues every observed original revocation before a later Task model effect when four fences are held', async () => {
    const f = await taskFixture()
    const tasks: Awaited<ReturnType<typeof f.addStructuredTask>>[] = []
    for (let index = 2; index <= 6; index++) {
      tasks.push(await f.addStructuredTask(index))
    }
    const target = tasks.at(-1)!
    const read = f.records.tasks.readActive.bind(f.records.tasks)
    let releaseRead!: () => void, readStarted!: () => void, releaseFences!: () => void
    const heldRead = new Promise<void>((resolveHold) => {
      releaseRead = resolveHold
    })
    const readReady = new Promise<void>((resolveReady) => {
      readStarted = resolveReady
    })
    const heldFences = new Promise<void>((resolveHold) => {
      releaseFences = resolveHold
    })
    vi.spyOn(f.records.tasks, 'readActive').mockImplementationOnce(async (validate) => {
      readStarted()
      await heldRead
      return read(validate)
    })
    const originalFence = f.host.fenceRevokedExecution.bind(f.host)
    let fences = 0
    vi.spyOn(f.host, 'fenceRevokedExecution').mockImplementation(async (...args) => {
      if (++fences <= 4) {
        await heldFences
      }
      await originalFence(...args)
    })
    const checking = f.monitor.check()
    await readReady
    const start = vi.fn(() => 'synthetic effect')
    try {
      await f.account.signOut()
      await f.account.signIn({ sessionProfile: 'TRUSTED' })
      await vi.waitFor(() => expect(f.ownership.getState().relation).toBe('CLAIMED_BY_CURRENT'))
      expect(() => f.issuer.assertExecutionCurrent(target.task)).not.toThrow()
      await expect(
        f.records.tasks.runModelEffect(
          target.structured,
          () => f.issuer.assertExecutionCurrent(target.task),
          start
        )
      ).rejects.toThrow()
      expect(start).not.toHaveBeenCalled()
    } finally {
      releaseFences()
      releaseRead()
      await checking
    }
  })
  it('does not miss logout revocation while an authorization read is held across immediate new login', async () => {
    const f = await taskFixture()
    const read = f.records.tasks.readActive.bind(f.records.tasks)
    let release!: () => void, started!: () => void
    const held = new Promise<void>((resolveHold) => {
      release = resolveHold
    })
    const ready = new Promise<void>((resolveReady) => {
      started = resolveReady
    })
    vi.spyOn(f.records.tasks, 'readActive').mockImplementationOnce(async (validate) => {
      started()
      await held
      return read(validate)
    })
    const check = f.monitor.check()
    await ready
    try {
      await f.account.signOut()
      await f.account.signIn({ sessionProfile: 'TRUSTED' })
      await vi.waitFor(() => expect(f.ownership.getState().relation).toBe('CLAIMED_BY_CURRENT'))
    } finally {
      release()
    }
    await check
    await f.monitor.check()
    expect(f.records.tasks.get(f.record.command)?.cancellationKey).toBe(
      `revoked:${f.record.commandFingerprint}`
    )
  })
  it.each(['account', 'authority', 'cloud-session', 'opaque-token', 'expired-token', 'profile'])(
    'revokes the original Task on a refreshed %s boundary',
    async (changed) => {
      const f = await taskFixture()
      const next = response('boundary')
      if (changed === 'account') {
        next.account.accountId = '323e4567-e89b-42d3-a456-426614174000'
        next.accessToken = token('boundary', { sub: next.account.accountId })
      } else if (changed === 'authority') {
        next.authorityId = 'other-authority'
        next.accessToken = token('boundary', { authority_id: next.authorityId })
      } else if (changed === 'cloud-session') {
        next.accessToken = token('boundary', { session_id: '823e4567-e89b-42d3-a456-426614174000' })
      } else if (changed === 'opaque-token') {
        next.accessToken = 'opaque-offline-token'
      } else if (changed === 'expired-token') {
        next.accessToken = token('boundary', { exp: (TASK_TEST_NOW - 1000) / 1000 })
      } else if (changed === 'profile') {
        f.refresh.mockResolvedValueOnce({ ...next, sessionProfile: 'TEMPORARY' })
      }
      if (changed !== 'profile') {
        f.refresh.mockResolvedValueOnce(next)
      }
      const originalGeneration = f.account.getRuntimeCloudAuthorization()!.sessionGeneration
      await f.account.refresh()
      await f.monitor.check()
      expect(f.account.getRuntimeCloudAuthorization()!.sessionGeneration).toBe(
        originalGeneration + 1
      )
      expect(f.records.tasks.get(f.record.command)?.cancellationKey).toBe(
        `revoked:${f.record.commandFingerprint}`
      )
      expect(f.records.tasks.get(f.record.command)?.result).toBeNull()
    }
  )

  it.each(['new-login', 'logout', 'generation', 'expired-original', 'manual-refresh'])(
    'keeps the existing original Task revocation boundary for %s',
    async (changed) => {
      const f = await taskFixture()
      if (changed === 'new-login') {
        await f.account.signIn({ sessionProfile: 'TRUSTED' })
      } else if (changed === 'logout') {
        await f.account.signOut()
      } else if (changed === 'generation') {
        const current = readHiveAccountSession(directory)
        if (current.status !== 'ok') {
          throw new Error('Expected synthetic current session')
        }
        saveHiveAccountSession(directory, {
          ...current.value,
          generation: current.value.generation + 1
        })
      } else if (changed === 'expired-original') {
        vi.mocked(Date.now).mockReturnValue(TASK_TEST_NOW + 600_001)
        f.refresh.mockResolvedValueOnce({
          ...response('after-gap'),
          expiresAt: TASK_TEST_NOW + 1_200_000,
          accessToken: token('after-gap', { exp: (TASK_TEST_NOW + 1_200_000) / 1000 })
        })
        await f.account.refresh()
      } else {
        let release!: (value: HiveAccountRuntimeDirectoryEntry) => void
        f.owned.mockReturnValueOnce(
          new Promise((resolveHold) => {
            release = resolveHold
          })
        )
        const refreshing = f.ownership.refresh()
        await f.monitor.check()
        release(ownedRuntime(f.record.command.runtimeRecordId))
        await refreshing
      }
      await f.monitor.check()
      expect(f.records.tasks.get(f.record.command)?.cancellationKey).toBe(
        `revoked:${f.record.commandFingerprint}`
      )
    }
  )

  it.each([new HiveAccountRequestError(401, null), new TypeError('synthetic offline failure')])(
    'cannot clear a newer same-generation rotation after a superseded refresh failure',
    async (error) => {
      const f = await accountFixture()
      const original = readHiveAccountSession(directory)
      if (original.status !== 'ok') {
        throw new Error('Expected synthetic session')
      }
      let reject!: (error: unknown) => void
      f.refresh.mockReturnValueOnce(
        new Promise((_resolve, rejectRefresh) => {
          reject = rejectRefresh
        })
      )
      const pending = f.account.refresh()
      const newer = {
        ...original.value,
        accessToken: token('newer'),
        savedAt: original.value.savedAt + 1
      }
      saveHiveAccountSession(directory, newer)
      reject(error)
      await pending
      expect(f.account.getRuntimeCloudAuthorization()?.accessToken === newer.accessToken).toBe(true)
      expect(f.revoke).not.toHaveBeenCalled()
    }
  )

  it('fails closed on current session rejection and does not grant a new credential on a network failure', async () => {
    const f = await taskFixture()
    const before = f.account.getRuntimeCloudAuthorization()!
    f.refresh.mockRejectedValueOnce(new TypeError('synthetic offline failure'))
    await expect(f.account.refresh()).resolves.toMatchObject({ status: 'failed' })
    expect(f.account.getRuntimeCloudAuthorization()?.accessToken === before.accessToken).toBe(true)
    expect(f.account.getRuntimeCloudAuthorization()?.sessionGeneration).toBe(
      before.sessionGeneration
    )
    f.refresh.mockRejectedValueOnce(new HiveAccountRequestError(401, null))
    await expect(f.account.refresh()).resolves.toMatchObject({ status: 'signed-out' })
    await f.monitor.check()
    expect(f.account.getRuntimeCloudAuthorization()).toBeNull()
    expect(f.records.tasks.get(f.record.command)?.cancellationKey).toBe(
      `revoked:${f.record.commandFingerprint}`
    )
  })
  it.each([
    'owner-missing',
    'owner-changed',
    'runtime',
    'authority',
    'fencing',
    'authority-generation',
    'lease-epoch',
    'lease-missing',
    'lease-identity',
    'boot'
  ])(
    'cannot retain claimed authority when its %s proof is unavailable or changed',
    async (changed) => {
      const f = await taskFixture()
      f.changeProof(changed)
      let release!: (value: HiveAccountRuntimeDirectoryEntry) => void
      f.owned.mockReturnValueOnce(
        new Promise((resolveHold) => {
          release = resolveHold
        })
      )
      try {
        await f.account.refresh()
        await f.monitor.check()
        expect(f.ownership.getState().relation).not.toBe('CLAIMED_BY_CURRENT')
        expect(() => f.issuer.assertExecutionCurrent(f.record)).toThrow('FORBIDDEN')
        expect(f.records.tasks.get(f.record.command)?.cancellationKey).toBe(
          `revoked:${f.record.commandFingerprint}`
        )
      } finally {
        release?.(ownedRuntime(f.record.command.runtimeRecordId))
      }
    }
  )
  it('rotates credentials without revoking the original Task during background ownership analysis', async () => {
    const f = await taskFixture()
    const generation = f.account.getRuntimeCloudAuthorization()!.sessionGeneration
    const lease = f.presence.service.getCurrentLeaseContext()
    let release!: (value: HiveAccountRuntimeDirectoryEntry) => void
    const held = new Promise<HiveAccountRuntimeDirectoryEntry>((resolveHold) => {
      release = resolveHold
    })
    f.owned.mockReturnValueOnce(held)
    try {
      await f.account.refresh()
      await vi.waitFor(() => expect(f.owned).toHaveBeenCalledTimes(2))
      await f.monitor.check()
      expect(f.records.tasks.get(f.record.command)?.cancellationKey).toBeNull()
      expect(f.account.getRuntimeCloudAuthorization()!.sessionGeneration).toBe(generation)
      expect(f.account.getRuntimeCloudAuthorization()!.accessToken).toBe(
        response('rotated').accessToken
      )
      expect(f.owned.mock.calls.at(-1)?.[1]).toBe(response('rotated').accessToken)
      expect(f.presence.service.getCurrentLeaseContext()).toEqual(lease)
      expect(f.ownership.getState().relation).toBe('CLAIMED_BY_CURRENT')
      expect(() => f.issuer.assertExecutionCurrent(f.record)).not.toThrow()
    } finally {
      release(ownedRuntime(f.record.command.runtimeRecordId))
    }
  })

  it('cannot replace or revoke a newer same-generation rotation with a late refresh using the same refresh token', async () => {
    const f = await accountFixture()
    const original = readHiveAccountSession(directory)
    if (original.status !== 'ok') {
      throw new Error('Expected synthetic session')
    }
    let release!: (value: ReturnType<typeof response>) => void
    f.refresh.mockReturnValueOnce(
      new Promise((resolveHold) => {
        release = resolveHold
      })
    )
    const pending = f.account.refresh()
    const newer = {
      ...original.value,
      accessToken: token('newer'),
      expiresAt: original.value.expiresAt + 1000,
      savedAt: original.value.savedAt + 1
    }
    saveHiveAccountSession(directory, newer)
    release({ ...response('late'), refreshToken: original.value.refreshToken })
    await pending
    const current = readHiveAccountSession(directory)
    expect(current.status).toBe('ok')
    expect(current.status === 'ok' && current.value.accessToken === newer.accessToken).toBe(true)
    expect(f.revoke).not.toHaveBeenCalled()
  })
})
