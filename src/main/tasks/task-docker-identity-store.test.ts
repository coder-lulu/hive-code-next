import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from '../sqlite/sync-database'
import { journalDatabasePath } from '../native-chat/agent-session-journal/journal-host-database'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { loadHiveRuntimeState } from '../runtime/agent-session-hive-state-rows'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore,
  readPersistedTestAgentSessionStoreText,
  editPersistedTestAgentSessionStore
} from '../runtime/agent-session-record-store-test-harness'
import { emptyState } from '../runtime/agent-session-store-parsing'
import { taskDockerBinding, type TaskDockerIdentity } from './task-docker-identity'
import {
  TaskExecutionRecordSchema,
  taskExecutionIdentity,
  taskExecutionRecordKey,
  type TaskExecutionRecord
} from './task-execution-record'
import {
  taskCommand,
  taskWorkspace,
  TASK_TEST_CALLER,
  TASK_TEST_LAUNCH,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

const evidence = resolve('logs/paperclip-development/p3/durable-docker/store/tmp')
const CID = 'b'.repeat(64)
let directory: string
let store: AgentSessionRecordStore
beforeEach(async () => {
  await mkdir(evidence, { recursive: true })
  directory = await mkdtemp(join(evidence, 'task-identity-'))
  await mkdir(taskWorkspace(directory).executionPath)
  store = await openTestAgentSessionRecordStore(directory)
})
afterEach(async () => {
  vi.restoreAllMocks()
  closeTestJournalHostDatabase(directory)
  await rm(directory, { recursive: true, force: true })
})
const validate: () => void = () => undefined
async function admission(dispatch = true) {
  const workspace = taskWorkspace(directory)
  const stat = await lstat(workspace.executionPath, { bigint: true })
  await store.tasks.admit({
    command: taskCommand(),
    ...TASK_TEST_CALLER,
    workspace: {
      ...workspace,
      directoryIdentity: {
        dev: stat.dev.toString(),
        ino: stat.ino.toString(),
        birthtimeNs: stat.birthtimeNs.toString()
      }
    },
    now: TASK_TEST_NOW,
    validate
  })
  if (dispatch) {
    await store.tasks.beginDispatch(taskCommand(), TASK_TEST_NOW, validate)
  }
  return store.tasks.get(taskCommand())!
}
function dockerIdentity(
  record: TaskExecutionRecord,
  containerId: string | null = null
): TaskDockerIdentity {
  return {
    dockerPath: process.execPath,
    endpoint:
      process.platform === 'win32'
        ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
        : 'unix:///var/run/docker.sock',
    imageId: `sha256:${'a'.repeat(64)}`,
    ...taskDockerBinding(record),
    daemon: {
      ID: 'daemon:original',
      OSType: 'linux',
      Architecture: 'amd64',
      ServerVersion: '29.8.1'
    },
    containerId
  }
}
function persist(identity: TaskDockerIdentity, owner = store, authorize = validate) {
  return owner.tasks.persistDockerIdentity(taskCommand(), identity, TASK_TEST_NOW, authorize)
}
function observeWrite(observe: () => void) {
  const database = openTestJournalHostDatabase(directory)
  const original = database.transaction.bind(database)
  return vi.spyOn(database, 'transaction').mockImplementationOnce((run) =>
    original((db) => {
      observe()
      const result = run(db)
      observe()
      return result
    })
  )
}

function failWrite() {
  const database = openTestJournalHostDatabase(directory)
  const original = database.transaction.bind(database)
  vi.spyOn(database, 'transaction').mockImplementationOnce((run) =>
    original((db) => {
      run(db)
      throw new Error('disk failure')
    })
  )
}

describe('Docker identity checkpoints in the original Task transaction', () => {
  it('refuses an asynchronous authorization result before committing a Docker generation', async () => {
    const original = await admission()
    const before = await readPersistedTestAgentSessionStoreText(directory)
    await expect(
      persist(dockerIdentity(original), store, () => Promise.resolve())
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
    expect(store.tasks.get(taskCommand())).toEqual(original)
  })
  it('keeps records without a Docker field readable after cold reload', async () => {
    const { record } = await store.tasks.admit({
      command: taskCommand(),
      ...TASK_TEST_CALLER,
      workspace: taskWorkspace(directory),
      now: TASK_TEST_NOW,
      validate
    })
    expect(record).not.toHaveProperty('dockerIdentity')
    expect((await openTestAgentSessionRecordStore(directory)).tasks.get(taskCommand())).toEqual(
      record
    )
    expect(TaskExecutionRecordSchema.safeParse(record).success).toBe(true)
  })

  it('cold reloads both checkpoints without new operations or status events', async () => {
    const original = await admission()
    const pending = dockerIdentity(original)
    const first = await persist(pending)
    expect(first.changed).toBe(true)
    expect(first.record.revision).toBe(original.revision + 1)
    store = await openTestAgentSessionRecordStore(directory)
    expect(store.tasks.get(taskCommand())).toEqual(first.record)
    const second = await persist({ ...pending, containerId: CID })
    store = await openTestAgentSessionRecordStore(directory)
    expect(store.tasks.get(taskCommand())).toEqual(second.record)
    expect(second.record.revision).toBe(original.revision + 2)
    expect(second.record.events).toEqual(original.events)
    expect(second.record.status).toBe('accepted')
    expect(second.record.dispatch).toBe('dispatching')
    expect(store.listOperationRows()).toEqual([])
  })

  it.each(['pending', 'cid'])('does not publish a held %s write', async (phase) => {
    const original = await admission()
    const pending = dockerIdentity(original)
    if (phase === 'cid') {
      await persist(pending)
    }
    const before = store.tasks.get(taskCommand())
    const text = await readPersistedTestAgentSessionStoreText(directory)
    const reader = new Database(journalDatabasePath(directory), {
      readonly: true,
      fileMustExist: true
    })
    let settled = false
    const write = observeWrite(() => {
      expect(settled).toBe(false)
      expect(store.tasks.get(taskCommand())).toEqual(before)
      expect(store.tasks.listActive()).toEqual([before])
      const loaded = emptyState('local')
      loadHiveRuntimeState(reader, loaded)
      expect(loaded.taskExecutions?.get(taskExecutionRecordKey(taskCommand()))).toEqual(before)
    })
    const checkpoint = persist(phase === 'cid' ? { ...pending, containerId: CID } : pending)
    void checkpoint.then(() => {
      settled = true
    })
    try {
      expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(text)
      await checkpoint
      expect(write).toHaveBeenCalledOnce()
      expect(settled).toBe(true)
    } finally {
      await checkpoint
      reader.close()
    }
    expect(store.tasks.get(taskCommand())?.dockerIdentity?.containerId).toBe(
      phase === 'cid' ? CID : null
    )
    expect((await openTestAgentSessionRecordStore(directory)).tasks.get(taskCommand())).toEqual(
      store.tasks.get(taskCommand())
    )
  })

  it.each(['pending', 'cid'])(
    'rolls back failed %s writes and keeps the queue usable',
    async (phase) => {
      const original = await admission()
      const pending = dockerIdentity(original)
      if (phase === 'cid') {
        await persist(pending)
      }
      const before = store.tasks.get(taskCommand())
      const text = await readPersistedTestAgentSessionStoreText(directory)
      const next = phase === 'cid' ? { ...pending, containerId: CID } : pending
      failWrite()
      await expect(persist(next)).rejects.toThrow('disk failure')
      expect(store.tasks.get(taskCommand())).toEqual(before)
      expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(text)
      expect((await openTestAgentSessionRecordStore(directory)).tasks.get(taskCommand())).toEqual(
        before
      )
      expect((await persist(next)).changed).toBe(true)
    }
  )

  it.each(['pending', 'cid'])(
    'same %s checkpoint is revision- and write-idempotent',
    async (phase) => {
      const pending = dockerIdentity(await admission())
      await persist(pending)
      const next = phase === 'cid' ? { ...pending, containerId: CID } : pending
      await persist(next)
      const before = store.tasks.get(taskCommand())
      const text = await readPersistedTestAgentSessionStoreText(directory)
      const write = vi.spyOn(openTestJournalHostDatabase(directory), 'transaction')
      const authorize = vi.fn()
      const repeated = await store.tasks.persistDockerIdentity(
        taskCommand(),
        structuredClone(next),
        TASK_TEST_NOW + 1,
        authorize
      )
      expect(authorize).toHaveBeenCalledTimes(1)
      expect(repeated).toEqual({ changed: false, record: before })
      expect(write).not.toHaveBeenCalled()
      expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(text)
    }
  )

  it('serializes checkpoints across store instances and conflicting exact CIDs', async () => {
    const pending = dockerIdentity(await admission())
    const other = await openTestAgentSessionRecordStore(directory)
    const initial = await Promise.all([persist(pending), persist(pending, other)])
    expect(initial.filter((value) => value.changed)).toHaveLength(1)
    const attempts = await Promise.allSettled([
      persist({ ...pending, containerId: CID }),
      persist({ ...pending, containerId: 'c'.repeat(64) }, other)
    ])
    expect(attempts.filter((value) => value.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((value) => value.status === 'rejected')).toHaveLength(1)
    const failed = attempts.find((value) => value.status === 'rejected')
    expect(failed?.reason?.message).toBe('IDEMPOTENCY_CONFLICT')
    const record = (await openTestAgentSessionRecordStore(directory)).tasks.get(taskCommand())!
    expect([CID, 'c'.repeat(64)]).toContain(record.dockerIdentity?.containerId)
    expect(record.revision).toBe(initial[0].record.revision + 1)
  })

  it('requires a pending checkpoint before the first exact CID', async () => {
    const before = await admission()
    await expect(persist(dockerIdentity(before, CID))).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(store.tasks.get(taskCommand())).toEqual(before)
  })

  it.each([
    { name: 'omitted', values: [] },
    { name: 'undefined', values: [undefined] },
    { name: 'null', values: [null] },
    { name: 'string', values: ['missing'] },
    { name: 'number', values: [0] },
    { name: 'object', values: [{}] }
  ])(
    'rejects $name authority validators without mutating the original Task',
    async ({ values }) => {
      const before = await admission()
      const text = await readPersistedTestAgentSessionStoreText(directory)
      const write = vi.spyOn(openTestJournalHostDatabase(directory), 'transaction')
      await expect(
        Reflect.apply(store.tasks.persistDockerIdentity, store.tasks, [
          taskCommand(),
          dockerIdentity(before),
          TASK_TEST_NOW,
          ...values
        ])
      ).rejects.toThrow('INVALID_REQUEST')
      expect(store.tasks.get(taskCommand())).toEqual(before)
      expect(write).not.toHaveBeenCalled()
      expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(text)
      expect((await openTestAgentSessionRecordStore(directory)).tasks.get(taskCommand())).toEqual(
        before
      )
    }
  )

  it('rejects CID replacement and pending regression without changing the original', async () => {
    const pending = dockerIdentity(await admission())
    await persist(pending)
    await persist({ ...pending, containerId: CID })
    const before = store.tasks.get(taskCommand())
    await expect(persist({ ...pending, containerId: 'c'.repeat(64) })).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
    await expect(persist(pending)).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(store.tasks.get(taskCommand())).toEqual(before)
  })

  it.each(['dockerPath', 'endpoint', 'imageId', 'daemonId', 'daemonVersion', 'daemonArchitecture'])(
    'rejects changed immutable %s',
    async (field) => {
      const pending = dockerIdentity(await admission())
      await persist(pending)
      const changed = structuredClone(pending)
      if (field === 'dockerPath') {
        changed.dockerPath = join(directory, 'another-docker')
      }
      if (field === 'endpoint') {
        changed.endpoint = 'unix:///another.sock'
      }
      if (field === 'imageId') {
        changed.imageId = `sha256:${'c'.repeat(64)}`
      }
      if (field === 'daemonId') {
        changed.daemon.ID = 'daemon:another'
      }
      if (field === 'daemonVersion') {
        changed.daemon.ServerVersion = '29.8.2'
      }
      if (field === 'daemonArchitecture') {
        changed.daemon.Architecture = 'x86_64'
      }
      const before = store.tasks.get(taskCommand())
      await expect(persist(changed)).rejects.toThrow('IDEMPOTENCY_CONFLICT')
      await expect(persist({ ...changed, containerId: CID })).rejects.toThrow(
        'IDEMPOTENCY_CONFLICT'
      )
      expect(store.tasks.get(taskCommand())).toEqual(before)
    }
  )

  it.each([
    'io.hive.task.runtime',
    'io.hive.task.ownership-epoch',
    'io.hive.task.execution',
    'io.hive.task.execution-epoch',
    'io.hive.task.command-fingerprint',
    'io.hive.task.workspace'
  ] as const)('rejects changed original label %s on first admission', async (field) => {
    const before = await admission()
    const pending = dockerIdentity(before)
    const labels = {
      ...pending.labels,
      [field]: field.endsWith('epoch')
        ? '9'
        : field.endsWith('fingerprint') || field.endsWith('workspace')
          ? 'c'.repeat(64)
          : 'another:binding'
    }
    await expect(persist({ ...pending, labels })).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(store.tasks.get(taskCommand())).toEqual(before)
  })

  it('rejects changed deterministic name and key ownership epoch', async () => {
    const before = await admission()
    const pending = dockerIdentity(before)
    await expect(persist({ ...pending, name: `hive-task-${'c'.repeat(64)}` })).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
    await persist(pending)
    await expect(
      store.tasks.persistDockerIdentity(
        { ...taskCommand(), ownershipEpoch: taskCommand().ownershipEpoch + 1 },
        pending,
        TASK_TEST_NOW,
        validate
      )
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(store.tasks.get(taskCommand())?.revision).toBe(before.revision + 1)
  })

  it('refuses a missing Task key after validating original authority', async () => {
    const pending = dockerIdentity(await admission())
    const authorize = vi.fn()
    await expect(
      store.tasks.persistDockerIdentity(
        { ...taskCommand(), executionId: 'execution:missing' },
        pending,
        TASK_TEST_NOW,
        authorize
      )
    ).rejects.toThrow('EXECUTION_NOT_FOUND')
    expect(authorize).toHaveBeenCalledTimes(1)
    await expect(
      store.tasks.persistDockerIdentity(
        { ...taskCommand(), executionEpoch: 9 },
        pending,
        TASK_TEST_NOW,
        () => {
          throw new Error('revoked')
        }
      )
    ).rejects.toThrow('revoked')
  })

  it.each(['before', 'between', 'same'])(
    'rejects revoked authority %s checkpoints',
    async (phase) => {
      const pending = dockerIdentity(await admission())
      if (phase !== 'before') {
        await persist(pending)
      }
      const before = store.tasks.get(taskCommand())
      const next = phase === 'between' ? { ...pending, containerId: CID } : pending
      await expect(
        persist(next, store, () => {
          throw new Error('revoked')
        })
      ).rejects.toThrow('revoked')
      expect(store.tasks.get(taskCommand())).toEqual(before)
    }
  )

  it('rechecks revocation after a competing held transaction releases the lock', async () => {
    const pending = dockerIdentity(await admission())
    const first = persist(pending)
    let revoked = false
    const authorize = vi.fn(() => {
      if (revoked) {
        throw new Error('revoked')
      }
    })
    const next = persist({ ...pending, containerId: CID }, store, authorize)
    void next.catch(() => undefined)
    expect(authorize).not.toHaveBeenCalled()
    revoked = true
    await first
    await expect(next).rejects.toThrow('revoked')
    expect(store.tasks.get(taskCommand())?.dockerIdentity).toEqual(pending)
  })

  it.each(['before', 'between'])(
    'rejects cancellation %s checkpoints and retains cleanup identity',
    async (phase) => {
      const pending = dockerIdentity(await admission())
      if (phase === 'between') {
        await persist(pending)
      }
      await store.tasks.requestCancellation(
        taskCommand(),
        'cancel:identity',
        TASK_TEST_NOW,
        validate
      )
      const before = store.tasks.get(taskCommand())
      await expect(
        persist(phase === 'between' ? { ...pending, containerId: CID } : pending)
      ).rejects.toThrow('OUTCOME_UNKNOWN')
      expect(store.tasks.get(taskCommand())).toEqual(before)
      expect((await openTestAgentSessionRecordStore(directory)).tasks.get(taskCommand())).toEqual(
        before
      )
    }
  )

  it.each(['before', 'between', 'same'])(
    'refuses blocked recovery %s checkpoints',
    async (phase) => {
      const pending = dockerIdentity(await admission())
      if (phase !== 'before') {
        await persist(pending)
      }
      const persisted = await readPersistedTestAgentSessionStore(directory)
      await editPersistedTestAgentSessionStore(directory, (state) =>
        Object.assign(state, { ...persisted, taskRecoveryBlocked: true })
      )
      const before = store.tasks.get(taskCommand())
      const authorize = vi.fn()
      await expect(
        persist(phase === 'between' ? { ...pending, containerId: CID } : pending, store, authorize)
      ).rejects.toThrow('OUTCOME_UNKNOWN')
      expect(authorize).toHaveBeenCalledTimes(1)
      expect(store.tasks.get(taskCommand())).toEqual(before)
      await expect(persist({ ...pending, containerId: CID })).rejects.toThrow('OUTCOME_UNKNOWN')
    }
  )

  it.each(['not_dispatched', 'running', 'unknown', 'terminal'])(
    'refuses %s state without gaining prepare authority',
    async (phase) => {
      const beforeDispatch = await admission(phase !== 'not_dispatched')
      const pending = dockerIdentity(beforeDispatch)
      if (phase === 'running') {
        await store.tasks.bindLaunch(
          store.tasks.get(taskCommand())!,
          TASK_TEST_LAUNCH,
          TASK_TEST_NOW
        )
      }
      if (phase === 'unknown') {
        await store.tasks.markUnknown(taskCommand(), TASK_TEST_NOW)
      }
      if (phase === 'terminal') {
        await store.tasks.settle(
          taskCommand(),
          {
            ...taskExecutionIdentity(beforeDispatch.command),
            commandFingerprint: beforeDispatch.commandFingerprint,
            kind: 'execution.result',
            status: 'failed',
            recordedAt: new Date(TASK_TEST_NOW).toISOString(),
            receiptId: 'result:identity',
            outcomeRef: 'outcome:identity',
            artifactRefs: [],
            usageFactRefs: [],
            stopProof: {
              proofRef: 'proof:identity',
              evidenceKind: 'stopped',
              managedToolsSettled: true,
              writersFenced: true,
              recordedAt: new Date(TASK_TEST_NOW).toISOString()
            }
          },
          TASK_TEST_NOW
        )
      }
      const before = store.tasks.get(taskCommand())
      await expect(persist(pending)).rejects.toThrow('OUTCOME_UNKNOWN')
      expect(store.tasks.get(taskCommand())).toEqual(before)
    }
  )

  it('rejects malformed durable identities in the record and original store decoder', async () => {
    const record = await admission()
    const pending = dockerIdentity(record)
    const persisted = await readPersistedTestAgentSessionStore(directory)
    const invalid = [
      null,
      {},
      { ...pending, secret: 'synthetic-forbidden' },
      { ...pending, containerId: 'short' },
      { ...pending, daemon: { ...pending.daemon, OSType: 'windows' } },
      { ...pending, labels: { ...pending.labels, extra: 'forbidden' } },
      { ...pending, name: `hive-task-${'c'.repeat(64)}` },
      { ...pending, labels: { ...pending.labels, 'io.hive.task.workspace': 'c'.repeat(64) } }
    ]
    for (const identity of invalid) {
      const malformed = { ...record, dockerIdentity: identity }
      expect(TaskExecutionRecordSchema.safeParse(malformed).success).toBe(false)
      const reader = new Database(':memory:')
      try {
        reader.exec(
          'CREATE TABLE agent_session_store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
        )
        reader.prepare('INSERT INTO agent_session_store_meta (key, value) VALUES (?, ?)').run(
          'hive_runtime_state',
          JSON.stringify({
            hostId: persisted.hostId,
            hiveSessions: persisted.hiveSessions,
            taskExecutions: { [taskExecutionRecordKey(record.command)]: malformed }
          })
        )
        expect(() => loadHiveRuntimeState(reader, emptyState('local'))).toThrow()
      } finally {
        reader.close()
      }
    }
    expect(
      TaskExecutionRecordSchema.safeParse({ ...record, dockerIdentity: pending }).success
    ).toBe(true)
    expect(
      TaskExecutionRecordSchema.safeParse({
        ...record,
        dockerIdentity: pending,
        workspace: { ...record.workspace, directoryIdentity: undefined }
      }).success
    ).toBe(false)
    expect(
      TaskExecutionRecordSchema.safeParse({
        ...record,
        dockerIdentity: pending,
        workspace: {
          ...record.workspace,
          executionPath: `${record.workspace.executionPath}-changed`
        }
      }).success
    ).toBe(false)
    expect(
      TaskExecutionRecordSchema.safeParse({
        ...record,
        dockerIdentity: pending,
        workspace: {
          ...record.workspace,
          directoryIdentity: { ...record.workspace.directoryIdentity!, ino: '9' }
        }
      }).success
    ).toBe(false)
    await expect(persist({ ...pending, containerId: 'short' })).rejects.toThrow('INVALID_REQUEST')
    expect(store.tasks.get(taskCommand())).toEqual(record)
  })

  it('returns detached records and retains immutable saved labels', async () => {
    const pending = dockerIdentity(await admission())
    const committed = await persist(pending)
    committed.record.dockerIdentity!.daemon.ID = 'tampered:caller'
    pending.daemon.ID = 'tampered:input'
    expect(store.tasks.get(taskCommand())?.dockerIdentity?.daemon.ID).toBe('daemon:original')
    expect(
      (await openTestAgentSessionRecordStore(directory)).tasks.get(taskCommand())?.dockerIdentity
        ?.daemon.ID
    ).toBe('daemon:original')
  })
})
