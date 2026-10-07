import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLocalTaskRuntime } from './local-task-runtime'
import { taskCommand } from './task-execution.test-fixture'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP } from '../../shared/hive-runtime-cloud'
import { rpcContext, runtimeStub } from '../runtime/rpc/methods/agent-launch.test-fixture'
import { Store } from '../persistence'
import { ProfileStateSqliteAuthority } from '../persistence/profile-state/profile-state-sqlite-authority'

const ports = vi.hoisted(() => ({ resources: vi.fn(), project: vi.fn() }))
vi.mock('../runtime/structured-agent-session-runtime', () => ({
  getStructuredAgentSessionResources: ports.resources
}))
vi.mock('../native-chat/hive-agent-local-project', () => ({
  resolveHiveAgentLocalProject: ports.project
}))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: () => ({ nth_repo_added: 2 })
}))
vi.mock('../ssh/ssh-config-parser', () => ({
  loadUserSshConfig: () => ({ hosts: [] }),
  sshConfigHostsToTargets: () => []
}))
type Service = Awaited<ReturnType<typeof startLocalTaskRuntime>>
const services: Service[] = []
const profiles: { store: Store; authority: ProfileStateSqliteAuthority }[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()))
  for (const { store, authority } of profiles.splice(0)) {
    store.freezeWrites()
    await store.flushAsync()
    authority.close()
    await authority.drainBackups()
  }
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
async function fixture() {
  const temporary = resolve(
    'logs/paperclip-development/p3/task-authentication-refresh-continuity/writer/tmp'
  )
  await mkdir(temporary, { recursive: true })
  const userDataPath = await mkdtemp(join(temporary, 'runtime-'))
  const source = join(userDataPath, 'source')
  await mkdir(source)
  await writeFile(join(source, 'input.txt'), 'synthetic assembly input')
  const records = await openTestAgentSessionRecordStore(join(userDataPath, 'records'))
  const resourceGuard = vi.fn<() => void>(() => undefined)
  const sourceGuard = vi.fn<() => void>(() => undefined)
  ports.resources.mockResolvedValue({ store: records, assertCurrent: resourceGuard })
  ports.project.mockResolvedValue({
    projectScope: 'id:synthetic-source',
    workspaceKind: 'folder',
    assertCurrent: sourceGuard
  })
  const launchRuntime = runtimeStub()
  launchRuntime.showTerminalWorkspaceLaunchScope.mockResolvedValue({
    id: 'synthetic-source',
    path: source,
    connectionId: null,
    repo: null,
    folderWorkspace: null
  })
  const runtime = rpcContext(launchRuntime, {}).runtime
  const authority = new ProfileStateSqliteAuthority(
    join(userDataPath, 'profile-state.db'),
    'task-runtime-assembly'
  )
  const store = new Store({
    dataFile: join(userDataPath, 'profile.json'),
    profileStateAuthority: authority
  })
  profiles.push({ store, authority })
  const createFolderWorkspace = vi.spyOn(store, 'createFolderWorkspace')
  const account = {
    accountId: 'synthetic-account',
    authorityId: 'synthetic-authority',
    sessionGeneration: 1,
    accessToken: 'fixture-only',
    sessionExpiresAt: Date.now() + 120_000
  }
  let signedOut = false
  const listeners = new Set<() => void>()
  const start = async () => {
    const service = await startLocalTaskRuntime({
      userDataPath,
      runtime,
      store,
      account: {
        getRuntimeCloudAuthorization: () => (signedOut ? null : account),
        subscribeRuntimeCloudAuthorization: (listener) => {
          const notify = () => listener(signedOut ? null : account)
          listeners.add(notify)
          return () => listeners.delete(notify)
        }
      },
      ownership: {
        getState: () => ({
          ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
          relation: 'CLAIMED_BY_CURRENT',
          accountId: account.accountId,
          sessionGeneration: account.sessionGeneration,
          runtimeRecordId: 'runtime:one',
          presence: 'ONLINE'
        }),
        subscribe: () => () => undefined
      },
      presence: {
        getCurrentLeaseContext: () => ({
          authorityId: account.authorityId,
          identity: {
            schemaVersion: 1,
            runtimeInstanceId: 'synthetic-instance',
            privateKeyPkcs8: 'fixture-only',
            publicKey: 'fixture-only',
            createdAt: Date.now()
          },
          tuple: {
            authorityGeneration: 1,
            runtimeRecordId: 'runtime:one',
            runtimeInstanceId: 'synthetic-instance',
            bootId: 'synthetic-boot',
            heartbeatLeaseId: 'synthetic-lease',
            leaseEpoch: 1,
            fencingEpoch: 1
          }
        }),
        subscribeLeaseContext: () => () => undefined
      }
    })
    services.push(service)
    return service
  }
  const input = {
    paperclipCompanyId: 'company:one',
    paperclipAgentId: 'agent:codex',
    task: { ...taskCommand().task, spaceId: 'company:one' },
    workspaceSelector: 'id:synthetic-source',
    input: 'Write report.md.'
  }
  return {
    userDataPath,
    source,
    resourceGuard,
    sourceGuard,
    createFolderWorkspace,
    start,
    input,
    records,
    signOut: () => {
      signedOut = true
      for (const listener of listeners) {
        listener()
      }
    }
  }
}
describe('original local Task runtime producer assembly', () => {
  it('drains original captured revocation after public runtime close while resources remain authentic', async () => {
    const h = await fixture(),
      service = await h.start()
    const binding = await service.issuer.issue(h.input)
    const grant = service.issuer.resolveGrant(binding.command.authorizationRef)!
    await h.records.tasks.admit({
      command: binding.command,
      operationCallerKey: 'trusted-local:runtime',
      workspace: grant.workspace,
      now: Date.now(),
      validate: grant.assertCurrent
    })
    const originalFence = service.host.fenceRevokedExecution.bind(service.host)
    let release!: () => void, started!: () => void
    const held = new Promise<void>((resolveHold) => {
      release = resolveHold
    })
    const ready = new Promise<void>((resolveReady) => {
      started = resolveReady
    })
    vi.spyOn(service.host, 'fenceRevokedExecution').mockImplementation(async (...args) => {
      started()
      await held
      await originalFence(...args)
    })
    h.signOut()
    await ready
    const closing = service.close()
    expect(service.close()).toBe(closing)
    expect(() => grant.assertCurrent()).toThrow()
    release()
    await closing
    expect(h.records.tasks.get(binding.command)?.cancellationKey).toBe(
      `revoked:${binding.commandFingerprint}`
    )
    expect(h.resourceGuard).toHaveBeenCalled()
  })
  it('reports unresolved original revocation when resources are unavailable and retries without reopening public grants', async () => {
    const h = await fixture(),
      service = await h.start()
    const binding = await service.issuer.issue(h.input)
    const grant = service.issuer.resolveGrant(binding.command.authorizationRef)!
    await h.records.tasks.admit({
      command: binding.command,
      operationCallerKey: 'trusted-local:runtime',
      workspace: grant.workspace,
      now: Date.now(),
      validate: grant.assertCurrent
    })
    const originalFence = service.host.fenceRevokedExecution.bind(service.host)
    let release!: () => void, started!: () => void
    const held = new Promise<void>((resolveHold) => {
      release = resolveHold
    })
    const ready = new Promise<void>((resolveReady) => {
      started = resolveReady
    })
    vi.spyOn(service.host, 'fenceRevokedExecution').mockImplementation(async (...args) => {
      started()
      await held
      await originalFence(...args)
    })
    h.signOut()
    await ready
    h.resourceGuard.mockImplementation(() => Promise.resolve())
    const closing = service.close()
    release()
    await expect(closing).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(h.records.tasks.get(binding.command)?.cancellationKey).toBeNull()
    expect(() => grant.assertCurrent()).toThrow()
    h.resourceGuard.mockImplementation(() => undefined)
    await service.close()
    expect(h.records.tasks.get(binding.command)?.cancellationKey).toBe(
      `revoked:${binding.commandFingerprint}`
    )
    expect(() => grant.assertCurrent()).toThrow()
  })
  it('refuses an async resource guard before publishing a runtime transport', async () => {
    const h = await fixture()
    h.resourceGuard.mockImplementation(() => Promise.resolve())
    await expect(h.start()).rejects.toThrow('FORBIDDEN')
    expect(existsSync(join(h.userDataPath, 'hive-tasks', 'transport.json'))).toBe(false)
  })
  it('checks the source proof in its first resolver frame before copying or registering a folder', async () => {
    const h = await fixture()
    const service = await h.start()
    h.sourceGuard.mockImplementationOnce(() => Promise.resolve())
    await expect(service.issuer.issue(h.input)).rejects.toThrow('FORBIDDEN')
    expect(h.sourceGuard).toHaveBeenCalledTimes(1)
    expect(h.createFolderWorkspace).not.toHaveBeenCalled()
    expect(existsSync(join(h.userDataPath, 'hive-tasks', 'workspaces'))).toBe(false)
  })
  it('keeps the synchronous assembly enabled and fences a captured grant when resources become async', async () => {
    const h = await fixture()
    const service = await h.start()
    const binding = await service.issuer.issue(h.input)
    const grant = service.issuer.resolveGrant(binding.command.authorizationRef)
    if (!grant) {
      throw new Error('Missing original local runtime grant.')
    }
    expect(existsSync(join(h.userDataPath, 'hive-tasks', 'transport.json'))).toBe(true)
    expect(() => grant.assertCurrent()).not.toThrow()
    h.resourceGuard.mockImplementation(() => new Promise<void>(() => undefined))
    expect(() => grant.assertCurrent()).toThrow('FORBIDDEN')
  })
})
