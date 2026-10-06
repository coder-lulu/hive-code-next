import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  taskCommand,
  taskTestDirectory,
  taskWorkspace,
  TASK_TEST_NOW
} from './task-execution.test-fixture'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import {
  readTaskArtifactFile,
  TaskArtifactIndex,
  taskResultManifestName
} from './task-artifact-index'

let root = ''
afterEach(async () => {
  if (root) {
    closeTestJournalHostDatabase(root)
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  root = await taskTestDirectory()
  const store = await openTestAgentSessionRecordStore(root)
  const record = (
    await store.tasks.admit({
      command: taskCommand(),
      workspace: taskWorkspace(root),
      operationCallerKey: 'service:local-test',
      now: TASK_TEST_NOW,
      validate: () => undefined
    })
  ).record
  await mkdir(record.workspace.executionPath)
  await writeFile(join(record.workspace.executionPath, 'report.md'), 'original artifact')
  const manifest = {
    schemaVersion: 1,
    executionId: record.command.executionId,
    commandFingerprint: record.commandFingerprint,
    status: 'succeeded',
    artifacts: ['report.md']
  }
  const manifestPath = join(
    record.workspace.executionPath,
    taskResultManifestName(record.commandFingerprint)
  )
  await writeFile(manifestPath, JSON.stringify(manifest))
  return { record, manifest, manifestPath, index: new TaskArtifactIndex(join(root, 'artifacts')) }
}
describe('host task artifact evidence', () => {
  it('keeps the referenced file immutable after the task workspace changes', async () => {
    const { record, index } = await fixture()
    const candidate = await index.collect(record, 'success')
    await writeFile(join(record.workspace.executionPath, 'report.md'), 'later write')
    expect(candidate?.status).toBe('succeeded')
    expect(
      await readFile(
        join(root, 'artifacts', candidate!.artifactRefs[0]!.slice('artifact:'.length)),
        'utf8'
      )
    ).toBe('original artifact')
  })
  it('does not let a success manifest override an API failure verdict', async () => {
    const { record, index } = await fixture()
    expect((await index.collect(record, 'failure'))?.status).toBe('failed')
  })
  it('settles an explicit provider failure even when no manifest was written', async () => {
    const { record, index, manifestPath } = await fixture()
    await rm(manifestPath)
    expect(await index.collect(record, 'success')).toBeNull()
    expect(await index.collect(record, 'failure')).toMatchObject({
      status: 'failed',
      artifactRefs: []
    })
  })
  it('reads only an artifact included in the matching immutable outcome', async () => {
    const { record, index } = await fixture()
    const result = await index.collect(record, 'success')
    expect(await index.read(result!.outcomeRef, result!.artifactRefs[0]!)).toEqual({
      name: 'report.md',
      text: 'original artifact'
    })
    await expect(index.read(result!.outcomeRef, `artifact:${'f'.repeat(64)}`)).rejects.toThrow(
      'FORBIDDEN'
    )
  })
  it('rejects a result from a different execution', async () => {
    const { record, index, manifest, manifestPath } = await fixture()
    await writeFile(manifestPath, JSON.stringify({ ...manifest, executionId: 'other' }))
    await expect(index.collect(record, 'success')).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  })
  it.each(['../outside', '/outside', 'C:/private', 'folder\\file', './report.md'])(
    'rejects an escaping artifact path %s',
    async (path) => {
      const { record } = await fixture()
      await expect(readTaskArtifactFile(record.workspace.executionPath, path, 64)).rejects.toThrow(
        'FORBIDDEN'
      )
    }
  )
  it('rejects symlinked artifact parents', async () => {
    const { record } = await fixture()
    await mkdir(join(root, 'outside'))
    await writeFile(join(root, 'outside', 'secret'), 'must not export')
    await symlink(join(root, 'outside'), join(record.workspace.executionPath, 'alias'), 'junction')
    await expect(
      readTaskArtifactFile(record.workspace.executionPath, 'alias/secret', 64)
    ).rejects.toThrow('FORBIDDEN')
  })
})
