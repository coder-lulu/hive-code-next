import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import {
  taskTestDirectory,
  TASK_TEST_NOW,
  taskCommand,
  taskCapabilities,
  TASK_TEST_LAUNCH
} from './task-execution.test-fixture'
import { createLocalTaskAuthorizer } from './local-task-authority'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { localTaskBindingKey } from './local-task-binding-file'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import { TaskExecutionHost } from './task-execution-host'
import { startLocalTaskTransport } from './local-task-transport'
import { createLocalTaskServiceCredential } from './local-task-service-credential'
import { LocalTaskClient } from './local-task-client'
import { HiveRuntimeAdapterBinding } from './paperclip-adapter-contract'
import { taskExecutionIdentity } from './task-execution-record'
import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'

let root = ''
let issuer: LocalTaskBindingIssuer | undefined
afterEach(async () => {
  await issuer?.close()
  closeTestJournalHostDatabases()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  root = await taskTestDirectory()
  const path = join(root, 'source')
  await mkdir(path)
  await writeFile(join(path, 'untracked.txt'), 'user content')
  let account = {
    accountId: 'account',
    authorityId: 'authority',
    sessionGeneration: 1,
    accessToken: 'private',
    sessionExpiresAt: TASK_TEST_NOW + 120_000
  }
  const currentAccount = () => account
  let ownershipEpoch = 1
  const currentRuntime = () => ({
    accountId: 'account',
    runtimeRecordId: 'runtime:one',
    ownershipEpoch
  })
  const registerWorkspace = vi.fn(async () => ({
    workspaceId: 'folder:isolated',
    assertCurrent: () => undefined
  }))
  const records = await openTestAgentSessionRecordStore(join(root, 'records'))
  let now = TASK_TEST_NOW
  const options = {
    directory: join(root, 'tasks'),
    operationCallerKey: 'trusted-local:runtime',
    currentAccount,
    currentRuntime,
    resolveSource: async () => ({ path, assertCurrent: () => undefined }),
    registerWorkspace,
    readExecution: (command: Parameters<typeof records.tasks.get>[0]) => records.tasks.get(command),
    restoreWorkspace: async () => ({ assertCurrent: () => undefined }),
    now: () => now
  }
  issuer = new LocalTaskBindingIssuer(options)
  const input = {
    paperclipCompanyId: 'company:one',
    paperclipAgentId: 'agent:codex',
    task: { ...taskCommand().task, spaceId: 'company:one' },
    workspaceSelector: 'id:user-workspace',
    input: 'Write report.md.'
  }
  const authorize = createLocalTaskAuthorizer({
    currentAccount,
    currentRuntime,
    resolveGrant: issuer.resolveGrant,
    now: () => now
  })
  return {
    issuer,
    input,
    registerWorkspace,
    records,
    options,
    authorize,
    advanceTime: (milliseconds: number) => {
      now += milliseconds
    },
    restart: () => {
      issuer = new LocalTaskBindingIssuer(options)
      return issuer
    },
    switchAccount: () => {
      account = { ...account, accountId: 'other' }
    },
    renewOwner: () => {
      account = { ...account, authorityId: 'authority:renewed', sessionGeneration: 2 }
      ownershipEpoch = 2
    },
    authorizer: (current: LocalTaskBindingIssuer) =>
      createLocalTaskAuthorizer({
        currentAccount,
        currentRuntime,
        resolveGrant: current.resolveGrant,
        now: () => now
      })
  }
}
describe('trusted task binding issuer', () => {
  it('fences an actual HTTP start held before its last spawn check', async () => {
    const h = await fixture()
    const binding = await h.issuer.issue(h.input)
    let release!: () => void, notify!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      notify = resolve
    })
    const host = new TaskExecutionHost({
      store: h.records.tasks,
      now: () => TASK_TEST_NOW,
      authorize: h.authorize,
      capabilities: () => taskCapabilities(binding.command),
      launch: async (record, authorization) => {
        notify()
        await held
        authorization.assertCurrent()
        return { ...TASK_TEST_LAUNCH, worktreeId: record.workspace.workspaceId }
      },
      collect: async () => null,
      stop: async () => null
    })
    const credential = createLocalTaskServiceCredential('trusted-local:runtime')
    const transport = await startLocalTaskTransport({
      host,
      authenticate: credential.authenticate,
      capabilities: () => taskCapabilities(binding.command),
      resolveBinding: (company, run, purpose, caller) =>
        h.issuer.resolveBinding(company, run, caller.operationCallerKey, purpose)
    })
    const client = new LocalTaskClient({ baseUrl: transport.baseUrl, secret: credential.secret })
    try {
      await client.start(binding.command, binding.commandFingerprint)
      await ready
      const recovered = HiveRuntimeAdapterBinding.parse(
        await client.binding(h.input.paperclipCompanyId, h.input.task.runId, 'recover')
      )
      expect(recovered.commandFingerprint).toBe(binding.commandFingerprint)
      await expect(client.start(binding.command, binding.commandFingerprint)).rejects.toThrow(
        'FORBIDDEN'
      )
      release()
      await host.drain()
      expect(h.records.tasks.get(binding.command)?.launch).toBeNull()
      expect(h.records.tasks.get(binding.command)?.status).toBe('outcome_unknown')
    } finally {
      release()
      await transport.close()
      await host.drain()
    }
  })
  it('hydrates active bindings without scanning accumulated terminal or unrelated files', async () => {
    const h = await fixture()
    const binding = await h.issuer.issue(h.input)
    const grant = h.issuer.resolveGrant(binding.command.authorizationRef)!
    await h.records.tasks.admit({
      command: binding.command,
      operationCallerKey: 'trusted-local:runtime',
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
    await Promise.all(
      Array.from({ length: 600 }, (_, index) =>
        writeFile(
          join(h.options.directory, 'bindings', `${index.toString(16).padStart(64, '0')}.json`),
          '{}',
          { mode: 0o600 }
        )
      )
    )
    await h.issuer.close()
    const fresh = h.restart()
    expect(await fresh.restoreBindings(h.records.tasks.listActive())).toEqual({
      restored: 1,
      unavailable: 0
    })
  })
  it('expires terminal grant caches while retaining their durable execution and binding', async () => {
    const h = await fixture()
    const binding = await h.issuer.issue(h.input)
    const grant = h.issuer.resolveGrant(binding.command.authorizationRef)!
    await h.records.tasks.admit({
      command: binding.command,
      operationCallerKey: 'trusted-local:runtime',
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
    await h.records.tasks.requestCancellation(
      binding.command,
      'cancel:cache',
      TASK_TEST_NOW,
      () => undefined
    )
    const recordedAt = new Date(TASK_TEST_NOW).toISOString()
    await h.records.tasks.settle(
      binding.command,
      {
        ...taskExecutionIdentity(binding.command),
        commandFingerprint: binding.commandFingerprint,
        recordedAt,
        kind: 'execution.result',
        status: 'cancelled',
        receiptId: 'result:cache',
        outcomeRef: 'outcome:cache',
        artifactRefs: [],
        usageFactRefs: [],
        stopProof: {
          proofRef: 'proof:cache',
          evidenceKind: 'not_started',
          managedToolsSettled: true,
          writersFenced: true,
          recordedAt
        }
      },
      TASK_TEST_NOW
    )
    const record = h.records.tasks.get(binding.command)!
    h.advanceTime(61_000)
    await h.issuer.issue({
      ...h.input,
      task: { ...h.input.task, taskId: 'task:next', runId: 'run:next' }
    })
    expect(h.issuer.resolveGrant(binding.command.authorizationRef)).toBeNull()
    expect(h.issuer.launchFingerprint(record)).toBeNull()
    const recovered = await h.issuer.resolveBinding(
      h.input.paperclipCompanyId,
      h.input.task.runId,
      'trusted-local:runtime',
      'recover'
    )
    expect(recovered.commandFingerprint).toBe(binding.commandFingerprint)
    expect(h.records.tasks.get(binding.command)?.result?.receiptId).toBe('result:cache')
    await expect(
      h.authorize({ operationCallerKey: 'trusted-local:runtime' }, recovered.command, 'start')
    ).rejects.toThrow('FORBIDDEN')
  })
  it('revokes a captured start authorization before issuing a recovery grant', async () => {
    const h = await fixture()
    const binding = await h.issuer.issue(h.input)
    const authorization = await h.authorize(
      { operationCallerKey: 'trusted-local:runtime' },
      binding.command,
      'start'
    )
    const { record } = await h.records.tasks.admit({
      command: binding.command,
      operationCallerKey: 'trusted-local:runtime',
      workspace: authorization.workspace,
      now: TASK_TEST_NOW,
      validate: authorization.assertCurrent
    })
    const recovered = await h.issuer.resolveBinding(
      h.input.paperclipCompanyId,
      h.input.task.runId,
      'trusted-local:runtime',
      'recover'
    )
    expect(authorization.assertCurrent).toThrow('FORBIDDEN')
    expect(h.issuer.resolveGrant(binding.command.authorizationRef)).toBeNull()
    expect(recovered.commandFingerprint).toBe(binding.commandFingerprint)
    expect(recovered.command.operationId).toBe(binding.command.operationId)
    expect(() => h.issuer.assertExecutionCurrent(record)).not.toThrow()
    await expect(
      h.authorize({ operationCallerKey: 'trusted-local:runtime' }, recovered.command, 'observe')
    ).resolves.toBeDefined()
    await expect(
      h.authorize({ operationCallerKey: 'trusted-local:runtime' }, recovered.command, 'start')
    ).rejects.toThrow('FORBIDDEN')
    const again = await h.issuer.resolveBinding(
      h.input.paperclipCompanyId,
      h.input.task.runId,
      'trusted-local:runtime',
      'recover'
    )
    expect(again.command.authorizationRef).toBe(recovered.command.authorizationRef)
    await expect(
      h.issuer.resolveBinding(
        h.input.paperclipCompanyId,
        h.input.task.runId,
        'trusted-local:runtime',
        'execute'
      )
    ).rejects.toThrow('FORBIDDEN')
  })
  it('fences a paused start before admission without inventing an execution receipt', async () => {
    const h = await fixture()
    const binding = await h.issuer.issue(h.input)
    const authorization = await h.authorize(
      { operationCallerKey: 'trusted-local:runtime' },
      binding.command,
      'start'
    )
    const recovered = await h.issuer.resolveBinding(
      h.input.paperclipCompanyId,
      h.input.task.runId,
      'trusted-local:runtime',
      'recover'
    )
    expect(authorization.assertCurrent).toThrow('FORBIDDEN')
    expect(h.records.tasks.get(binding.command)).toBeNull()
    expect(recovered.command.executionId).toBe(binding.command.executionId)
    await expect(
      h.authorize({ operationCallerKey: 'trusted-local:runtime' }, recovered.command, 'cancel')
    ).resolves.toBeDefined()
    expect(h.registerWorkspace).toHaveBeenCalledOnce()
  })
  it('coalesces concurrent preparation into one copy and stable binding', async () => {
    const h = await fixture()
    const [first, second] = await Promise.all([h.issuer.issue(h.input), h.issuer.issue(h.input)])
    expect(second).toEqual(first)
    expect(h.registerWorkspace).toHaveBeenCalledTimes(1)
    const grant = await h.authorize(
      { operationCallerKey: 'trusted-local:runtime' },
      first.command,
      'start'
    )
    expect(grant.workspace.executionPath).not.toBe(grant.workspace.canonicalPath)
    expect(grant.input).toContain(first.command.executionId)
  })
  it('rejects changing task input under the same run before another workspace is created', async () => {
    const h = await fixture()
    await h.issuer.issue(h.input)
    await expect(h.issuer.issue({ ...h.input, input: 'Other work' })).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
    expect(h.registerWorkspace).toHaveBeenCalledTimes(1)
  })
  it('revokes both issued and pending authorizations after switching account', async () => {
    const h = await fixture()
    const binding = await h.issuer.issue(h.input)
    const grant = await h.authorize(
      { operationCallerKey: 'trusted-local:runtime' },
      binding.command,
      'start'
    )
    h.switchAccount()
    expect(grant.assertCurrent).toThrow('FORBIDDEN')
    await expect(
      h.issuer.resolveBinding(
        h.input.paperclipCompanyId,
        h.input.task.runId,
        'trusted-local:runtime',
        'execute'
      )
    ).rejects.toThrow('FORBIDDEN')
  })
  it('never remints an execution from persisted intent after a restart', async () => {
    const h = await fixture()
    await h.issuer.issue(h.input)
    await h.issuer.close()
    const fresh = h.restart()
    await expect(fresh.issue(h.input)).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(h.registerWorkspace).toHaveBeenCalledTimes(1)
  })
  it('restores the existing execution under limited fresh authority without another workspace', async () => {
    const h = await fixture()
    const binding = await h.issuer.issue(h.input)
    const grant = h.issuer.resolveGrant(binding.command.authorizationRef)!
    const { record } = await h.records.tasks.admit({
      command: binding.command,
      operationCallerKey: 'trusted-local:runtime',
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
    const originalLaunchFingerprint = h.issuer.launchFingerprint(record)
    await h.issuer.close()
    const fresh = h.restart()
    expect(await fresh.restoreBindings(h.records.tasks.listActive())).toEqual({
      restored: 1,
      unavailable: 0
    })
    const recovered = await Promise.all(
      Array.from({ length: 8 }, () =>
        fresh.resolveBinding(
          h.input.paperclipCompanyId,
          h.input.task.runId,
          'trusted-local:runtime',
          'recover'
        )
      )
    )
    expect(new Set(recovered.map((value) => value.command.authorizationRef)).size).toBe(1)
    expect(recovered[0].bindingRef).toBe(binding.bindingRef)
    expect(recovered[0].command.operationId).toBe(binding.command.operationId)
    expect(computeTaskExecutionFingerprint(recovered[0].command, 'trusted-local:runtime')).toBe(
      binding.commandFingerprint
    )
    expect(fresh.launchFingerprint(record)).toBe(originalLaunchFingerprint)
    const authorize = h.authorizer(fresh)
    await expect(
      authorize({ operationCallerKey: 'trusted-local:runtime' }, recovered[0].command, 'observe')
    ).resolves.toMatchObject({ workspace: record.workspace })
    await expect(
      authorize({ operationCallerKey: 'trusted-local:runtime' }, recovered[0].command, 'start')
    ).rejects.toThrow('FORBIDDEN')
    expect(h.registerWorkspace).toHaveBeenCalledTimes(1)
  })
  it('separates a renewed read authority from the revoked original execution authority', async () => {
    const h = await fixture()
    const binding = await h.issuer.issue(h.input)
    const grant = h.issuer.resolveGrant(binding.command.authorizationRef)!
    const { record } = await h.records.tasks.admit({
      command: binding.command,
      operationCallerKey: 'trusted-local:runtime',
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
    await h.issuer.close()
    h.renewOwner()
    const fresh = h.restart()
    await fresh.restoreBindings(h.records.tasks.listActive())
    expect(() => fresh.assertExecutionCurrent(record)).toThrow('FORBIDDEN')
    const recovered = await fresh.resolveBinding(
      h.input.paperclipCompanyId,
      h.input.task.runId,
      'trusted-local:runtime',
      'recover'
    )
    const authorize = h.authorizer(fresh)
    await expect(
      authorize({ operationCallerKey: 'trusted-local:runtime' }, recovered.command, 'cancel')
    ).resolves.toBeDefined()
    await expect(
      authorize({ operationCallerKey: 'trusted-local:runtime' }, recovered.command, 'start')
    ).rejects.toThrow('FORBIDDEN')
    expect(recovered.command.ownershipEpoch).toBe(binding.command.ownershipEpoch)
  })
  it('rejects a persisted intent that no longer matches the protected execution record', async () => {
    const h = await fixture()
    const binding = await h.issuer.issue(h.input)
    const grant = h.issuer.resolveGrant(binding.command.authorizationRef)!
    await h.records.tasks.admit({
      command: binding.command,
      operationCallerKey: 'trusted-local:runtime',
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
    await h.issuer.close()
    const key = localTaskBindingKey(h.input.paperclipCompanyId, h.input.task.runId)
    await writeFile(
      join(h.options.directory, 'bindings', `${key}.intent.json`),
      JSON.stringify({ fingerprint: '0'.repeat(64), input: { ...h.input, input: 'changed' } })
    )
    const fresh = h.restart()
    expect(await fresh.restoreBindings(h.records.tasks.listActive())).toEqual({
      restored: 0,
      unavailable: 1
    })
    await expect(
      fresh.resolveBinding(
        h.input.paperclipCompanyId,
        h.input.task.runId,
        'trusted-local:runtime',
        'recover'
      )
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(fresh.resolveGrant(binding.command.authorizationRef)).toBeNull()
  })
})
