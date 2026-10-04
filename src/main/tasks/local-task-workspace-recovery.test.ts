import { lstatSync } from 'node:fs'
import { mkdir, readFile, rename, rm, rmdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  editPersistedTestAgentSessionStore,
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStoreText
} from '../runtime/agent-session-record-store-test-harness'
import { localTaskBindingKey } from './local-task-binding-file'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { TASK_TEST_NOW, taskCommand, taskTestDirectory } from './task-execution.test-fixture'

let root = ''
let issuer: LocalTaskBindingIssuer | undefined
afterEach(async () => {
  await issuer?.close()
  if (root) {
    expect(dirname(root)).toBe(resolve('logs/paperclip-p1/tmp'))
    await rm(root, { recursive: true, force: true })
    root = ''
  }
})

async function fixture() {
  root = await taskTestDirectory()
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'input.txt'), 'original input')
  const recordDirectory = join(root, 'records')
  let records = await openTestAgentSessionRecordStore(recordDirectory)
  const registerWorkspace = vi.fn(async () => ({
    workspaceId: 'folder:isolated',
    assertCurrent: () => undefined
  }))
  const options = {
    directory: join(root, 'tasks'),
    operationCallerKey: 'trusted-local:runtime',
    currentAccount: () => ({
      accountId: 'account',
      authorityId: 'authority',
      sessionGeneration: 1,
      accessToken: 'fixture-only',
      sessionExpiresAt: TASK_TEST_NOW + 120_000
    }),
    currentRuntime: () => ({
      accountId: 'account',
      runtimeRecordId: 'runtime:one',
      ownershipEpoch: 1
    }),
    resolveSource: async () => ({ path: source, assertCurrent: () => undefined }),
    registerWorkspace,
    readExecution: (command: Parameters<typeof records.tasks.get>[0]) => records.tasks.get(command),
    restoreWorkspace: async () => ({ assertCurrent: () => undefined }),
    now: () => TASK_TEST_NOW
  }
  issuer = new LocalTaskBindingIssuer(options)
  const input = {
    paperclipCompanyId: 'company:one',
    paperclipAgentId: 'agent:codex',
    task: { ...taskCommand().task, spaceId: 'company:one' },
    workspaceSelector: 'id:source',
    input: 'Write report.md.'
  }
  const binding = await issuer.issue(input)
  const grant = issuer.resolveGrant(binding.command.authorizationRef)!
  const { record } = await records.tasks.admit({
    command: binding.command,
    operationCallerKey: options.operationCallerKey,
    workspace: grant.workspace,
    now: TASK_TEST_NOW,
    validate: grant.assertCurrent
  })
  const bindingPath = join(
    options.directory,
    'bindings',
    `${localTaskBindingKey(input.paperclipCompanyId, input.task.runId)}.json`
  )
  return {
    source,
    record,
    binding,
    bindingPath,
    recordDirectory,
    registerWorkspace,
    records: () => records,
    restart: async () => {
      await issuer!.close()
      records = await openTestAgentSessionRecordStore(recordDirectory)
      issuer = new LocalTaskBindingIssuer(options)
      return issuer
    },
    recover: () =>
      issuer!.resolveBinding(
        input.paperclipCompanyId,
        input.task.runId,
        options.operationCallerKey,
        'recover'
      )
  }
}

async function replaceDirectory(path: string) {
  const original = `${path}-original`
  expect(path.startsWith(`${root}\\`) || path.startsWith(`${root}/`)).toBe(true)
  await rename(path, original)
  await mkdir(path)
  return original
}

describe('durable task workspace identity', () => {
  it('retains a live claim and refuses a different directory at the original path after restart', async () => {
    const h = await fixture()
    const before = await readPersistedTestAgentSessionStoreText(h.recordDirectory)
    await replaceDirectory(h.record.workspace.executionPath)
    const fresh = await h.restart()
    expect(await fresh.restoreBindings(h.records().tasks.listActive())).toEqual({
      restored: 0,
      unavailable: 1
    })
    await expect(h.recover()).rejects.toThrow('FORBIDDEN')
    expect(h.records().tasks.get(h.binding.command)).toEqual(h.record)
    expect(await readPersistedTestAgentSessionStoreText(h.recordDirectory)).toBe(before)
    expect(h.registerWorkspace).toHaveBeenCalledTimes(1)
  })

  it('fences a captured recovery grant when its workspace is later replaced', async () => {
    const h = await fixture()
    const fresh = await h.restart()
    const recovered = await h.recover()
    const grant = fresh.resolveGrant(recovered.command.authorizationRef)!
    grant.assertCurrent()
    await replaceDirectory(h.record.workspace.executionPath)
    expect(() => grant.assertCurrent()).toThrow('FORBIDDEN')
    await expect(h.recover()).rejects.toThrow('FORBIDDEN')
    expect(h.records().tasks.get(h.binding.command)).toEqual(h.record)
  })

  it('refuses replacement evidence written only into the binding file', async () => {
    const h = await fixture()
    await replaceDirectory(h.record.workspace.executionPath)
    const stat = lstatSync(h.record.workspace.executionPath, { bigint: true })
    const stored = JSON.parse(await readFile(h.bindingPath, 'utf8'))
    stored.workspace.directoryIdentity = {
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      birthtimeNs: stat.birthtimeNs.toString()
    }
    await writeFile(h.bindingPath, JSON.stringify(stored))
    const fresh = await h.restart()
    expect(await fresh.restoreBindings(h.records().tasks.listActive())).toEqual({
      restored: 0,
      unavailable: 1
    })
    await expect(h.recover()).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(h.records().tasks.get(h.binding.command)).toEqual(h.record)
  })

  it('refuses a junction to the original directory instead of accepting a matching path', async () => {
    const h = await fixture()
    const original = await replaceDirectory(h.record.workspace.executionPath)
    await rmdir(h.record.workspace.executionPath)
    await symlink(original, h.record.workspace.executionPath, 'junction')
    const fresh = await h.restart()
    expect(await fresh.restoreBindings(h.records().tasks.listActive())).toEqual({
      restored: 0,
      unavailable: 1
    })
    await expect(h.recover()).rejects.toThrow('FORBIDDEN')
    expect(h.records().tasks.get(h.binding.command)).toEqual(h.record)
  })

  it('keeps an old record without original directory evidence occupied and does not backfill authority', async () => {
    const h = await fixture()
    await issuer!.close()
    await editPersistedTestAgentSessionStore(h.recordDirectory, (state) => {
      for (const record of Object.values(state.taskExecutions)) {
        delete record.workspace.directoryIdentity
      }
    })
    const stored = JSON.parse(await readFile(h.bindingPath, 'utf8'))
    delete stored.workspace.directoryIdentity
    await writeFile(h.bindingPath, JSON.stringify(stored))
    const before = await readFile(h.bindingPath, 'utf8')
    const fresh = await h.restart()
    expect(await fresh.restoreBindings(h.records().tasks.listActive())).toEqual({
      restored: 0,
      unavailable: 1
    })
    await expect(h.recover()).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(h.records().tasks.listActive()).toHaveLength(1)
    expect(h.records().tasks.get(h.binding.command)?.result).toBeNull()
    expect(await readFile(h.bindingPath, 'utf8')).toBe(before)
    expect(h.registerWorkspace).toHaveBeenCalledTimes(1)
  })

  it('persists exact bigint directory evidence with the execution rather than recapturing it at restart', async () => {
    const h = await fixture()
    const stat = lstatSync(h.record.workspace.executionPath, { bigint: true })
    expect(h.record.workspace.directoryIdentity).toEqual({
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      birthtimeNs: stat.birthtimeNs.toString()
    })
    const fresh = await h.restart()
    expect(await fresh.restoreBindings(h.records().tasks.listActive())).toEqual({
      restored: 1,
      unavailable: 0
    })
    expect(h.records().tasks.get(h.binding.command)?.workspace).toEqual(h.record.workspace)
  })

  it('allows task file writes and restores its managed copy when the original source is gone', async () => {
    const h = await fixture()
    await writeFile(join(h.record.workspace.executionPath, 'report.md'), 'task output')
    await rename(h.source, `${h.source}-retired`)
    const fresh = await h.restart()
    expect(await fresh.restoreBindings(h.records().tasks.listActive())).toEqual({
      restored: 1,
      unavailable: 0
    })
    expect((await h.recover()).command.operationId).toBe(h.binding.command.operationId)
    expect(await readFile(join(h.record.workspace.executionPath, 'report.md'), 'utf8')).toBe(
      'task output'
    )
    expect(h.registerWorkspace).toHaveBeenCalledTimes(1)
  })
})
