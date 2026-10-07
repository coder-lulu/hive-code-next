import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { restoreWorkflowTaskCode } from './task-workflow-code-input'
import { workflowCodeInputFixture } from './task-workflow-code-input.test-fixture'
import { LocalTaskBindingInputSchema } from './local-task-binding-file'

const roots: string[] = []
afterEach(async () => {
  closeTestJournalHostDatabases()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture(status: 'succeeded' | 'failed' = 'succeeded') {
  const f = await workflowCodeInputFixture(status)
  roots.push(f.root)
  return f
}

describe('fixed code input from the original authenticated host record', () => {
  it('rechecks the immutable producer only at I/O boundaries while keeping every ownership guard live', async () => {
    const f = await fixture(),
      readExecution = vi.fn(f.options.readExecution),
      assertCurrent = vi.fn(f.options.assertCurrent)
    const copy = await restoreWorkflowTaskCode({ ...f.options, readExecution, assertCurrent })
    expect(readExecution).toHaveBeenCalledTimes(3)
    const checked = assertCurrent.mock.calls.length
    for (let index = 0; index < 100; index++) {
      copy.assertCurrent()
    }
    expect(readExecution).toHaveBeenCalledTimes(3)
    expect(assertCurrent.mock.calls.length).toBeGreaterThanOrEqual(checked + 100)
  })
  it('rejects a replaced producer observed after restoring the copy', async () => {
    const f = await fixture()
    let reads = 0
    await expect(
      restoreWorkflowTaskCode({
        ...f.options,
        readExecution(identity) {
          const record = f.options.readExecution(identity)
          return ++reads < 3 || !record ? record : { ...record, revision: record.revision + 1 }
        }
      })
    ).rejects.toThrow('REVISION_CONFLICT')
  })
  it('restores the published version after both live project and producer tree change', async () => {
    const f = await fixture()
    await writeFile(join(f.project, 'app.ts'), 'new project version')
    await writeFile(join(f.record.workspace.executionPath, 'app.ts'), 'late producer change')
    const copy = await restoreWorkflowTaskCode(f.options)
    expect(await readFile(join(copy.executionPath, 'app.ts'), 'utf8')).toContain(
      'acceptedVersion = 1'
    )
    expect(copy.treeDigest).toBe(f.captured.version.treeDigest)
    copy.assertCurrent()
    await writeFile(join(copy.executionPath, 'app.ts'), 'tester replacement')
    expect(() => copy.assertUnchanged()).toThrow()
    copy.assertCurrent()
  })
  it('allows repair on the same developer Issue in a new attempt without changing the snapshot', async () => {
    const f = await fixture(),
      input = structuredClone(f.options.input)
    input.workflowContext.role = 'developer'
    input.workflowContext.employeeRef = input.paperclipAgentId = f.developer.employeeRef
    input.workflowContext.stageRef = f.developer.stageRef
    input.task.taskId = f.developer.taskId
    input.task.attempt = 2
    const copy = await restoreWorkflowTaskCode({ ...f.options, input })
    await writeFile(join(copy.executionPath, 'app.ts'), 'repaired version')
    copy.assertCurrent()
    const source = await f.options.snapshots.readSource(f.captured.version, f.record)
    expect(await readFile(join(source.path, 'app.ts'), 'utf8')).toContain('acceptedVersion = 1')
  })
  it.each([
    'employee',
    'session',
    'workspace',
    'claim',
    'workflow',
    'definition',
    'fingerprint',
    'owner',
    'project',
    'task',
    'deadline'
  ] as const)('rejects substituted %s before restoring any source', async (boundary) => {
    const f = await fixture(),
      options = {
        ...f.options,
        input: structuredClone(f.options.input),
        owner: { ...f.options.owner }
      },
      context = options.input.workflowContext,
      producer = context.codeInput!.producer
    if (boundary === 'employee') {
      producer.employeeRef = 'employee:foreign'
    }
    if (boundary === 'session') {
      producer.sessionRef = 'session:foreign'
    }
    if (boundary === 'workspace') {
      producer.executionWorkspaceRef = 'folder:foreign'
    }
    if (boundary === 'claim') {
      producer.workspaceExecutionClaimRef = 'claim:foreign'
    }
    if (boundary === 'workflow') {
      context.binding.workflowRunRef = 'workflow-run:foreign'
    }
    if (boundary === 'definition') {
      context.definitionDigest = 'f'.repeat(64)
    }
    if (boundary === 'fingerprint') {
      producer.commandFingerprint = 'f'.repeat(64)
    }
    if (boundary === 'owner') {
      options.owner.accountId = 'foreign-account'
    }
    if (boundary === 'project') {
      options.originalWorkspaceRef = 'workspace:foreign'
    }
    if (boundary === 'task') {
      options.input.task.taskId = producer.task.taskId
    }
    if (boundary === 'deadline') {
      options.input.executionDeadlineAt = new Date(Date.now() + 600_000).toISOString()
    }
    await expect(restoreWorkflowTaskCode(options)).rejects.toThrow('REVISION_CONFLICT')
  })
  it('requires a real stored producer and refuses diagnostic failure snapshots', async () => {
    const f = await fixture('failed')
    await expect(restoreWorkflowTaskCode(f.options)).rejects.toThrow('REVISION_CONFLICT')
    await expect(
      restoreWorkflowTaskCode({ ...f.options, readExecution: () => null })
    ).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('fences owner revocation during asset verification and copy', async () => {
    const f = await fixture()
    let checks = 0
    await expect(
      restoreWorkflowTaskCode({
        ...f.options,
        assertCurrent() {
          if (++checks >= 4) {
            throw new Error('FORBIDDEN')
          }
        }
      })
    ).rejects.toThrow('FORBIDDEN')
    expect(checks).toBeGreaterThanOrEqual(4)
  })
  it('rejects cross-company, employee and personal-policy metadata at the private binding boundary', async () => {
    const f = await fixture()
    expect(LocalTaskBindingInputSchema.safeParse(f.options.input).success).toBe(true)
    for (const patch of [
      { paperclipAgentId: 'employee:foreign' },
      { executionMode: undefined },
      { paperclipCompanyId: 'company:foreign' }
    ]) {
      expect(LocalTaskBindingInputSchema.safeParse({ ...f.options.input, ...patch }).success).toBe(
        false
      )
    }
  })
})
