import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { afterEach, expect, vi } from 'vitest'
import { taskStructuredFixture } from './task-structured-reservation.test-fixture'
import { taskWorkspace, TASK_TEST_NOW } from './task-execution.test-fixture'
import { TaskExecutionRecordSchema } from './task-execution-record'
import { TaskDockerIdentitySchema, taskDockerBinding } from './task-docker-identity'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'

const ARTIFACT_ROOT = resolve(
  'logs/paperclip-development/p3/task-startup-cancellation-proof/prestart-tests-writer/tmp'
)
const CID = 'b'.repeat(64)
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of roots.splice(0)) {
    if (dirname(resolve(directory)) !== ARTIFACT_ROOT) {
      throw new Error('fixture cleanup escaped its original root')
    }
    closeTestJournalHostDatabase(directory)
    await rm(directory, { recursive: true, force: true })
  }
})

export async function taskCancelledDockerPrestartFixture(cancel = true, capturedCid = false) {
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  const directory = await mkdtemp(join(ARTIFACT_ROOT, 'prestart-'))
  roots.push(directory)
  const workspace = taskWorkspace(directory)
  await mkdir(workspace.executionPath)
  const stat = await lstat(workspace.executionPath, { bigint: true })
  const f = taskStructuredFixture(
    {
      ...workspace,
      directoryIdentity: {
        dev: String(stat.dev),
        ino: String(stat.ino),
        birthtimeNs: String(stat.birthtimeNs)
      }
    },
    undefined,
    {
      requiredCapabilities: ['task.enforcement.v1'],
      executionPolicy: {
        trustMode: 'enforced_autonomous',
        executionPolicyRef: 'docker-local-linux',
        executionPolicyRevision: '1',
        enforcementEvidenceRef: `docker-enforcement:${'a'.repeat(64)}`
      }
    }
  )
  const store = await openTestAgentSessionRecordStore(directory)
  await store.tasks.admit(f.admission)
  await store.tasks.beginDispatch(f.command, TASK_TEST_NOW, f.validate)
  await store.admitOperation({
    callerKey: f.outer.callerKey,
    operationId: f.outer.operationId,
    fingerprint: f.outer.fingerprint,
    now: TASK_TEST_NOW
  })
  await store.claimOperation(f.outer)
  await store.reserveOwner(f.request)
  await store.recordOperationOutcome({
    ...f.request.operation,
    outcome: { status: 'failed', code: 'synthetic_prestart_refusal' }
  })
  const task = store.tasks.get(f.command)!
  const identity = TaskDockerIdentitySchema.parse({
    dockerPath: process.execPath,
    endpoint: 'unix:///synthetic-docker.sock',
    imageId: `sha256:${'a'.repeat(64)}`,
    ...taskDockerBinding(task),
    daemon: {
      ID: 'daemon:synthetic',
      OSType: 'linux',
      Architecture: 'amd64',
      ServerVersion: '29.8.1'
    },
    containerId: null
  })
  await store.tasks.persistDockerIdentity(f.command, identity, TASK_TEST_NOW, f.validate)
  if (capturedCid) {
    await store.tasks.persistDockerIdentity(
      f.command,
      { ...identity, containerId: CID },
      TASK_TEST_NOW,
      f.validate
    )
  }
  const authorized = store.tasks.get(f.command)!
  if (cancel) {
    await store.tasks.requestCancellation(f.command, 'cancel:original', TASK_TEST_NOW, f.validate)
  }
  const expected = store.tasks.get(f.command)!
  expect(TaskExecutionRecordSchema.safeParse(expected).success).toBe(true)
  return {
    ...f,
    store,
    directory,
    authorized,
    expected,
    session: store.getRecord(f.request.sessionId)!,
    // Synthetic boundary facts exercise the private store contract; no Docker or Provider is called.
    evidence: { containerId: CID, observedAt: TASK_TEST_NOW }
  }
}
type Fixture = Awaited<ReturnType<typeof taskCancelledDockerPrestartFixture>>
export const settleTaskCancelledDockerPrestart = (
  f: Fixture,
  evidence = f.evidence,
  now = TASK_TEST_NOW,
  validate = () => undefined
) =>
  f.store.tasks.settleCancelledDockerPrestart(
    f.authorized,
    f.expected,
    f.session,
    evidence,
    () => now,
    validate
  )
export async function refreshTaskCancelledDockerPrestart(f: Fixture) {
  await f.store.tasks.readActive(() => undefined)
  f.expected = f.store.tasks.get(f.command)!
  f.session = f.store.getRecord(f.request.sessionId)!
}
export async function assertTaskCancelledDockerPrestartUnsettled(f: Fixture) {
  expect(f.store.tasks.get(f.command)?.result).toBeNull()
  expect(
    (await openTestAgentSessionRecordStore(f.directory)).tasks.get(f.command)?.result
  ).toBeNull()
}
