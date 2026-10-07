import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { afterEach, vi } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import type { TaskDockerEnforcement } from './task-docker-enforcement'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { TaskExecutionHost, type TaskExecutionHostDependencies } from './task-execution-host'
import {
  taskCapabilities,
  taskCommand,
  taskStopEvidence,
  taskWorkspace,
  TASK_TEST_LAUNCH,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

const temporary = resolve('logs/paperclip-development/p3/case-execution/deadline/tmp')
const roots: string[] = []
const issuers: LocalTaskBindingIssuer[] = []
const hosts: TaskExecutionHost[] = []
afterEach(async () => {
  await Promise.all(issuers.splice(0).map((issuer) => issuer.close()))
  await Promise.all(hosts.splice(0).map((host) => host.drain()))
  closeTestJournalHostDatabases()
  for (const root of roots.splice(0)) {
    const suffix = relative(temporary, root)
    if (!suffix || isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) {
      throw new Error('Unexpected deadline fixture directory.')
    }
    await rm(root, { recursive: true, force: true })
  }
})

async function directory() {
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'task-'))
  roots.push(root)
  return root
}

export async function taskDeadlineHostFixture() {
  const root = await directory()
  const records = await openTestAgentSessionRecordStore(join(root, 'records'))
  let now = TASK_TEST_NOW
  const authorization = {
    workspace: taskWorkspace(root),
    input: 'Write report.md.',
    assertCurrent: () => undefined
  }
  const deps = {
    store: records.tasks,
    now: () => now,
    capabilities: () => taskCapabilities(),
    authorize: vi.fn(async () => authorization),
    launch: vi.fn(
      async (
        _record: Parameters<TaskExecutionHostDependencies['launch']>[0],
        _authorization: Parameters<TaskExecutionHostDependencies['launch']>[1]
      ) => TASK_TEST_LAUNCH
    ),
    collect: vi.fn(async () => null),
    stop: vi.fn(async (record: Parameters<typeof taskStopEvidence>[0]) => taskStopEvidence(record))
  }
  const host = new TaskExecutionHost(deps)
  hosts.push(host)
  return { host, deps, authorization, setNow: (value: number) => (now = value) }
}

export async function localDeadlineBindingFixture() {
  const root = await directory()
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'input.txt'), 'Synthetic task input.')
  const recordsDirectory = join(root, 'records')
  const records = await openTestAgentSessionRecordStore(recordsDirectory)
  const account = {
    accountId: 'deadline-test-account',
    authorityId: 'deadline-test-authority',
    sessionGeneration: 1,
    accessToken: 'fixture-only',
    sessionExpiresAt: TASK_TEST_NOW + 120_000
  }
  let now = TASK_TEST_NOW
  const runtime = {
    runtimeRecordId: 'runtime:one',
    ownershipEpoch: 1,
    accountId: account.accountId
  }
  const enforcement: TaskDockerEnforcement = {
    owner: {
      runtimeRecordId: runtime.runtimeRecordId,
      ownershipEpoch: runtime.ownershipEpoch,
      executionAccountRef: `account:${createHash('sha256').update(JSON.stringify(account.accountId)).digest('hex')}`
    },
    policy: {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'docker-local-linux',
      executionPolicyRevision: '1',
      enforcementEvidenceRef: `docker-enforcement:${'a'.repeat(64)}`
    },
    daemon: {
      ID: 'fixture-only',
      OSType: 'linux',
      Architecture: 'amd64',
      ServerVersion: 'fixture'
    },
    assertCurrent: () => undefined
  }
  const options = {
    directory: join(root, 'tasks'),
    operationCallerKey: 'trusted-local:deadline-test',
    currentAccount: () => account,
    currentRuntime: () => runtime,
    resolveSource: vi.fn(async () => ({ path: source, assertCurrent: () => undefined })),
    registerWorkspace: vi.fn(async () => ({
      workspaceId: 'folder:deadline-test',
      assertCurrent: () => undefined
    })),
    restoreWorkspace: async () => ({ assertCurrent: () => undefined }),
    readExecution: records.tasks.get.bind(records.tasks),
    resolveEnforcement: vi.fn(async () => enforcement),
    now: () => now
  }
  const create = () => {
    const issuer = new LocalTaskBindingIssuer(options)
    issuers.push(issuer)
    return issuer
  }
  const input = {
    paperclipCompanyId: 'company:deadline-test',
    paperclipAgentId: 'agent:codex',
    task: { ...taskCommand().task, spaceId: 'company:deadline-test' },
    workspaceSelector: 'id:deadline-test-source',
    input: 'Write report.md.'
  }
  return {
    root,
    records,
    recordsDirectory,
    options,
    create,
    input,
    setNow: (value: number) => (now = value)
  }
}
