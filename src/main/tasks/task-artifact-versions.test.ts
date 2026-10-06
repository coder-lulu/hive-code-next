import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import {
  taskCommand,
  taskWorkspace,
  TASK_TEST_LAUNCH,
  TASK_TEST_NOW
} from './task-execution.test-fixture'
import { taskExecutionIdentity } from './task-execution-record'
import { TaskArtifactIndex, taskResultManifestName } from './task-artifact-index'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const evidence = resolve('logs/paperclip-development/p3/case-outcomes/artifact-versions/tmp')
  await mkdir(evidence, { recursive: true })
  const root = await mkdtemp(join(evidence, 'fixture-'))
  roots.push(root)
  const store = await openTestAgentSessionRecordStore(root),
    command = taskCommand(),
    workspace = taskWorkspace(root)
  workspace.workspaceId = TASK_TEST_LAUNCH.worktreeId
  await mkdir(workspace.executionPath)
  await store.tasks.admit({
    command,
    workspace,
    operationCallerKey: 'service:local-test',
    now: TASK_TEST_NOW,
    validate: () => undefined
  })
  await store.tasks.beginDispatch(command, TASK_TEST_NOW, () => undefined)
  await store.tasks.bindLaunch(store.tasks.get(command)!, TASK_TEST_LAUNCH, TASK_TEST_NOW)
  const running = store.tasks.get(command)!
  await writeFile(join(workspace.executionPath, 'report.md'), 'versioned outcome')
  await writeFile(
    join(workspace.executionPath, taskResultManifestName(running.commandFingerprint)),
    JSON.stringify({
      schemaVersion: 1,
      executionId: command.executionId,
      commandFingerprint: running.commandFingerprint,
      status: 'succeeded',
      artifacts: ['report.md']
    })
  )
  const directory = join(root, 'artifacts'),
    index = new TaskArtifactIndex(directory),
    candidate = (await index.collect(running, 'success'))!
  const { record } = await store.tasks.settle(
    command,
    {
      ...taskExecutionIdentity(command),
      kind: 'execution.result',
      commandFingerprint: running.commandFingerprint,
      receiptId: `result:${randomUUID()}`,
      recordedAt: new Date(TASK_TEST_NOW).toISOString(),
      ...candidate,
      usageFactRefs: [],
      status: 'succeeded',
      stopProof: {
        proofRef: 'stop:synthetic-unit-fixture',
        evidenceKind: 'stopped',
        managedToolsSettled: true,
        writersFenced: true,
        recordedAt: new Date(TASK_TEST_NOW).toISOString()
      }
    },
    TASK_TEST_NOW
  )
  return {
    root,
    directory,
    index,
    record,
    running,
    ref: candidate.artifactRefs[0]!,
    outcomePath: join(directory, `outcome-${candidate.outcomeRef.slice(8)}.json`)
  }
}
describe('artifact version evidence from the original native result', () => {
  it('returns the content digest, distinct from the tuple-derived artifact reference', async () => {
    const f = await fixture(),
      description = await f.index.describe(f.record, f.ref)
    expect(description).toEqual({
      name: 'report.md',
      version: {
        artifactRef: f.ref,
        artifactRevision: 1,
        digest: createHash('sha256').update('versioned outcome').digest('hex')
      }
    })
    expect(description.version.digest).not.toBe(f.ref.slice(9))
    expect(await f.index.read(f.record.result!.outcomeRef, f.ref)).toEqual({
      name: 'report.md',
      text: 'versioned outcome'
    })
  })
  it('requires an original result that contains this exact artifact reference', async () => {
    const f = await fixture()
    await expect(f.index.describe(f.running, f.ref)).rejects.toThrow('FORBIDDEN')
    await expect(f.index.describe(f.record, `artifact:${'f'.repeat(64)}`)).rejects.toThrow(
      'FORBIDDEN'
    )
    await expect(
      f.index.describe({ ...f.record, commandFingerprint: 'f'.repeat(64) }, f.ref)
    ).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it.each(['name', 'status', 'omitted', 'duplicate'] as const)(
    'rejects altered outcome metadata: %s',
    async (boundary) => {
      const f = await fixture(),
        outcome = JSON.parse(await readFile(f.outcomePath, 'utf8'))
      if (boundary === 'name') {
        outcome.artifacts[0].name = 'other-report.md'
      }
      if (boundary === 'status') {
        outcome.status = 'failed'
      }
      if (boundary === 'omitted') {
        outcome.artifacts = []
      }
      if (boundary === 'duplicate') {
        outcome.artifacts.push(outcome.artifacts[0])
      }
      await writeFile(f.outcomePath, JSON.stringify(outcome))
      await expect(f.index.describe(f.record, f.ref)).rejects.toThrow()
    }
  )
  it('rejects a replaced content blob despite a matching old artifact reference', async () => {
    const f = await fixture()
    await writeFile(join(f.directory, f.ref.slice(9)), 'replaced content')
    await expect(f.index.describe(f.record, f.ref)).rejects.toThrow('OUTCOME_UNKNOWN')
  })
})
