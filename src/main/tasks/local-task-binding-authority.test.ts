import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { localTaskBindingKey } from './local-task-binding-file'
import { createLocalTaskAuthorizer } from './local-task-authority'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { taskCommand, TASK_TEST_NOW } from './task-execution.test-fixture'
import { createRecoveredLocalTaskGrant } from './local-task-recovery-grant'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStoreText
} from '../runtime/agent-session-record-store-test-harness'

const issuers: LocalTaskBindingIssuer[] = []
afterEach(async () => {
  await Promise.all(issuers.splice(0).map((issuer) => issuer.close()))
})
type Port = 'owner' | 'source' | 'registration' | 'restoration'
const asyncChecks = [
  { name: 'fulfilled', check: () => Promise.resolve() },
  { name: 'pending', check: () => new Promise<void>(() => undefined) }
]
async function fixture() {
  const temporary = resolve('logs/task-session-binding/writer-authority/tmp')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'binding-'))
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'input.txt'), 'synthetic task input')
  const stateDirectory = join(root, 'records')
  const records = await openTestAgentSessionRecordStore(stateDirectory)
  const returns = new Map<Port, unknown>()
  const currentAccount = () => ({
    accountId: 'synthetic-account',
    authorityId: 'synthetic-authority',
    sessionGeneration: 1,
    accessToken: 'fixture-only',
    sessionExpiresAt: TASK_TEST_NOW + 120_000
  })
  const currentRuntime = () => ({
    accountId: 'synthetic-account',
    runtimeRecordId: 'runtime:one',
    ownershipEpoch: 1
  })
  const guard = (port: Port) => () => returns.get(port)
  const registerWorkspace = vi.fn(async () => ({
    workspaceId: 'folder:isolated-test',
    assertCurrent: guard('registration')
  }))
  const options = {
    directory: join(root, 'tasks'),
    operationCallerKey: 'trusted-local:runtime',
    currentAccount,
    currentRuntime,
    assertCurrent: guard('owner'),
    resolveSource: async () => ({ path: source, assertCurrent: guard('source') }),
    registerWorkspace,
    restoreWorkspace: async () => ({ assertCurrent: guard('restoration') }),
    readExecution: (command: Parameters<typeof records.tasks.get>[0]) => records.tasks.get(command),
    now: () => TASK_TEST_NOW
  }
  const issuer = new LocalTaskBindingIssuer(options)
  issuers.push(issuer)
  const input = {
    paperclipCompanyId: 'company:one',
    paperclipAgentId: 'agent:codex',
    task: { ...taskCommand().task, spaceId: 'company:one' },
    workspaceSelector: 'id:synthetic-source',
    input: 'Write report.md.'
  }
  const issue = async () => issuer.issue(input)
  const admit = async () => {
    const binding = await issue()
    const grant = issuer.resolveGrant(binding.command.authorizationRef)
    if (!grant) {
      throw new Error('Missing original grant.')
    }
    const { record } = await records.tasks.admit({
      command: binding.command,
      operationCallerKey: options.operationCallerKey,
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
    return { binding, grant, record }
  }
  const restart = async () => {
    await issuer.close()
    const fresh = new LocalTaskBindingIssuer(options)
    issuers.push(fresh)
    return fresh
  }
  const recover = (current = issuer) =>
    current.resolveBinding(
      input.paperclipCompanyId,
      input.task.runId,
      options.operationCallerKey,
      'recover'
    )
  const authorizer = (current = issuer) =>
    createLocalTaskAuthorizer({
      currentAccount,
      currentRuntime,
      resolveGrant: current.resolveGrant,
      now: options.now
    })
  return {
    source,
    stateDirectory,
    records,
    returns,
    issuer,
    input,
    options,
    registerWorkspace,
    issue,
    admit,
    restart,
    recover,
    authorizer
  }
}

describe('original binding producer synchronous authority', () => {
  it.each(['owner', 'source', 'registration'] as const)(
    'refuses a Promise from %s before publishing a binding or live grant',
    async (port) => {
      const h = await fixture()
      h.returns.set(port, Promise.resolve())
      await expect(h.issue()).rejects.toThrow('FORBIDDEN')
      const key = localTaskBindingKey(h.input.paperclipCompanyId, h.input.task.runId)
      expect(existsSync(join(h.options.directory, 'bindings', `${key}.json`))).toBe(false)
      expect(h.records.tasks.listActive()).toEqual([])
      expect(h.records.listRecords()).toEqual([])
      if (port !== 'registration') {
        expect(h.registerWorkspace).not.toHaveBeenCalled()
      }
    }
  )
  for (const port of ['owner', 'source', 'registration'] as const) {
    it.each(asyncChecks)(
      `fences late ${port} $name authority in the captured grant`,
      async (item) => {
        const h = await fixture()
        const { binding, grant, record } = await h.admit()
        const before = await readPersistedTestAgentSessionStoreText(h.stateDirectory)
        h.returns.set(port, item.check())
        expect(() => assertTaskAuthorizationCurrent(() => grant.assertCurrent())).toThrow(
          'FORBIDDEN'
        )
        expect(() => h.issuer.assertExecutionCurrent(record)).toThrow('FORBIDDEN')
        await expect(h.issue()).rejects.toThrow('FORBIDDEN')
        await expect(
          h.authorizer()(
            { operationCallerKey: h.options.operationCallerKey },
            binding.command,
            'start'
          )
        ).rejects.toThrow('FORBIDDEN')
        expect(await readPersistedTestAgentSessionStoreText(h.stateDirectory)).toBe(before)
        expect(h.records.tasks.get(binding.command)).toEqual(record)
      }
    )
  }
  it.each(asyncChecks)(
    'refuses $name workspace proof while issuing a recovery grant',
    async (item) => {
      const h = await fixture()
      const { binding, grant, record } = await h.admit()
      const before = await readPersistedTestAgentSessionStoreText(h.stateDirectory)
      h.returns.set('restoration', item.check())
      await expect(h.recover()).rejects.toThrow('FORBIDDEN')
      expect(() => h.issuer.launchFingerprint(record)).toThrow('FORBIDDEN')
      expect(h.issuer.resolveGrant(binding.command.authorizationRef)).toBe(grant)
      expect(await readPersistedTestAgentSessionStoreText(h.stateDirectory)).toBe(before)
    }
  )
  it.each(asyncChecks)(
    'refuses $name proof during persisted hydration without replacing authority',
    async (item) => {
      const h = await fixture()
      const { binding, record } = await h.admit()
      const before = await readPersistedTestAgentSessionStoreText(h.stateDirectory)
      const fresh = await h.restart()
      h.returns.set('restoration', item.check())
      expect(await fresh.restoreBindings(h.records.tasks.listActive())).toEqual({
        restored: 0,
        unavailable: 1
      })
      await expect(h.recover(fresh)).rejects.toThrow('FORBIDDEN')
      expect(fresh.resolveGrant(binding.command.authorizationRef)).toBeNull()
      expect(h.records.tasks.get(binding.command)).toEqual(record)
      expect(await readPersistedTestAgentSessionStoreText(h.stateDirectory)).toBe(before)
    }
  )
  it.each(asyncChecks)('fences a late $name proof in a captured recovered grant', async (item) => {
    const h = await fixture()
    const { binding, record } = await h.admit()
    const fresh = await h.restart()
    const recovered = await h.recover(fresh)
    const grant = fresh.resolveGrant(recovered.command.authorizationRef)
    if (!grant) {
      throw new Error('Missing recovered grant.')
    }
    const before = await readPersistedTestAgentSessionStoreText(h.stateDirectory)
    h.returns.set('restoration', item.check())
    expect(() => assertTaskAuthorizationCurrent(() => grant.assertCurrent())).toThrow('FORBIDDEN')
    expect(() => fresh.assertExecutionCurrent(record)).toThrow('FORBIDDEN')
    expect(() => fresh.launchFingerprint(record)).toThrow('FORBIDDEN')
    await expect(h.recover(fresh)).rejects.toThrow('FORBIDDEN')
    expect(h.records.tasks.get(binding.command)).toEqual(record)
    expect(await readPersistedTestAgentSessionStoreText(h.stateDirectory)).toBe(before)
  })
  it('refuses a direct recovered-grant producer whose workspace callback returns a Promise', async () => {
    const h = await fixture()
    const { binding, grant } = await h.admit()
    const owner = { account: h.options.currentAccount(), runtime: h.options.currentRuntime() }
    expect(() =>
      createRecoveredLocalTaskGrant(
        {
          binding,
          accountId: grant.accountId,
          workspace: grant.workspace,
          input: grant.input,
          assertWorkspaceCurrent: () => Promise.resolve()
        },
        owner,
        () => owner,
        h.options.operationCallerKey
      )
    ).toThrow('FORBIDDEN')
  })
  it('checks the original live grant callback before returning an execute binding', async () => {
    const h = await fixture()
    const { grant } = await h.admit()
    grant.assertCurrent = () => Promise.resolve()
    await expect(h.issue()).rejects.toThrow('FORBIDDEN')
  })
  it('observes a rejected guard while refusing the captured grant synchronously', async () => {
    const h = await fixture()
    const { grant } = await h.admit()
    const rejection = Promise.reject(new Error('late producer revocation'))
    void rejection.catch(() => undefined)
    h.returns.set('source', rejection)
    expect(() => grant.assertCurrent()).toThrow('FORBIDDEN')
    await Promise.resolve()
  })
  it('preserves valid synchronous grants, binding replay and limited recovery actions', async () => {
    const h = await fixture()
    const { binding, grant, record } = await h.admit()
    expect(await h.issue()).toEqual(binding)
    expect(() => grant.assertCurrent()).not.toThrow()
    expect(h.issuer.launchFingerprint(record)).toMatch(/^[a-f0-9]{64}$/)
    const fresh = await h.restart()
    expect(await fresh.restoreBindings(h.records.tasks.listActive())).toEqual({
      restored: 1,
      unavailable: 0
    })
    const recovered = await h.recover(fresh)
    const authorization = await h.authorizer(fresh)(
      { operationCallerKey: h.options.operationCallerKey },
      recovered.command,
      'cancel'
    )
    expect(() => authorization.assertCurrent()).not.toThrow()
    await expect(
      h.authorizer(fresh)(
        { operationCallerKey: h.options.operationCallerKey },
        recovered.command,
        'start'
      )
    ).rejects.toThrow('FORBIDDEN')
    expect(recovered.commandFingerprint).toBe(binding.commandFingerprint)
    expect(recovered.command.operationId).toBe(binding.command.operationId)
  })
})
