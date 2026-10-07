import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import {
  workflowCaseCodeFixture,
  codeInspectionFixtureRoot
} from './hive-workflow-case-code.test-fixture'

const fixtures: Awaited<ReturnType<typeof workflowCaseCodeFixture>>[] = []
async function fixture(operationCallerKey?: string) {
  const f = await workflowCaseCodeFixture(operationCallerKey)
  fixtures.push(f)
  return f
}
afterEach(async () => {
  closeTestJournalHostDatabases()
  for (const f of fixtures.splice(0)) {
    const target = resolve(f.root)
    if (target.startsWith(codeInspectionFixtureRoot + sep)) {
      await rm(target, { recursive: true, force: true })
    }
  }
  vi.restoreAllMocks()
})
describe('owner reads of an original fixed Developer snapshot', () => {
  it('uses the original stopped record and snapshot and returns no native paths or authority', async () => {
    const f = await fixture()
    const page = await f.facade().getWorkflowCaseCodePage(f.query)
    expect(page.codeVersion).toEqual(f.handoff.codeVersion)
    expect(page.files.map((file) => file.path)).toEqual(['app.js', 'report.md'])
    expect(f.requests).toEqual([
      `/hive/tasks/${f.record.command.task.taskId}/runs/${f.record.command.task.runId}`
    ])
    const file = await f.facade().getWorkflowCaseCodeFile({ ...f.query, path: 'app.js' })
    expect(file.preview).toEqual({ kind: 'text', text: 'export const value = 1\n' })
    expect(JSON.stringify({ page, file })).not.toContain(f.root)
    expect(Object.keys(page)).toEqual(
      expect.arrayContaining(['codeVersion', 'files', 'nextCursor'])
    )
    expect(Object.keys(page)).not.toContain('authorizationRef')
  })
  it.each(['projectId', 'caseId', 'handoffRef'] as const)(
    'refuses a substituted %s before reading the asset',
    async (field) => {
      const f = await fixture(),
        spy = vi.spyOn(f.snapshots, 'getCodePage')
      const value =
        field === 'handoffRef' ? 'handoff:foreign' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      await expect(
        f.facade().getWorkflowCaseCodePage({ ...f.query, [field]: value })
      ).rejects.toThrow()
      expect(spy).not.toHaveBeenCalled()
    }
  )
  it('refuses authority or producer fields in a renderer request', async () => {
    const f = await fixture(),
      spy = vi.spyOn(f.snapshots, 'getCodePage')
    const request = { ...f.query, authorized: true }
    await expect(f.facade().getWorkflowCaseCodePage(request)).rejects.toThrow('INVALID_REQUEST')
    expect(spy).not.toHaveBeenCalled()
  })
  it('refuses a missing or foreign original host record', async () => {
    const f = await fixture(),
      spy = vi.spyOn(f.snapshots, 'getCodePage')
    f.currentRecord = null
    await expect(f.facade().getWorkflowCaseCodePage(f.query)).rejects.toThrow('EXECUTION_NOT_FOUND')
    expect(spy).not.toHaveBeenCalled()
    const foreign = await fixture('service:foreign')
    const foreignRead = vi.spyOn(foreign.snapshots, 'getCodePage')
    await expect(foreign.facade().getWorkflowCaseCodePage(foreign.query)).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    expect(foreignRead).not.toHaveBeenCalled()
  })
  it.each(['case', 'project', 'workspace', 'receipt', 'binding', 'employee'] as const)(
    'refuses substituted service %s provenance',
    async (field) => {
      const f = await fixture(),
        task = structuredClone(f.task),
        spy = vi.spyOn(f.snapshots, 'getCodePage')
      if (field === 'case') {
        task.run_scope.caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      }
      if (field === 'project') {
        task.run_scope.projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      }
      if (field === 'workspace') {
        task.run_scope.workspaceRef = 'workspace:foreign'
      }
      if (field === 'receipt') {
        task.result_receipt = { ...task.result_receipt!, outcomeRef: 'outcome:foreign' }
      }
      if (field === 'binding') {
        task.binding.commandFingerprint = 'b'.repeat(64)
      }
      if (field === 'employee') {
        task.agent_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      }
      f.task = task
      await expect(f.facade().getWorkflowCaseCodePage(f.query)).rejects.toThrow('REVISION_CONFLICT')
      expect(spy).not.toHaveBeenCalled()
    }
  )
  it('refuses revoked account state during the service read before file access', async () => {
    const f = await fixture(),
      spy = vi.spyOn(f.snapshots, 'getCodePage')
    f.onReadTask = () => {
      f.current = false
    }
    await expect(f.facade().getWorkflowCaseCodePage(f.query)).rejects.toThrow('FORBIDDEN')
    expect(spy).not.toHaveBeenCalled()
  })
  it('rechecks the original record and account after a delayed snapshot result', async () => {
    const f = await fixture(),
      original = f.snapshots.getCodePage.bind(f.snapshots)
    vi.spyOn(f.snapshots, 'getCodePage').mockImplementation(async (...args) => {
      const value = await original(...args)
      f.currentRecord = null
      return value
    })
    await expect(f.facade().getWorkflowCaseCodePage(f.query)).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('keeps authorized history readable when execution isolation is unavailable', async () => {
    const f = await fixture()
    expect(f.view.executionAvailability.available).toBe(false)
    expect((await f.facade().getWorkflowCaseCodePage(f.query)).files).toHaveLength(2)
  })
  it('reports a missing read dependency and hides native filesystem paths', async () => {
    const f = await fixture()
    f.source = null
    await expect(f.facade().getWorkflowCaseCodePage(f.query)).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    f.source = { snapshots: f.snapshots, readExecution: () => f.record }
    vi.spyOn(f.snapshots, 'getCodePage').mockRejectedValue(
      Object.assign(new Error(`missing ${f.root}`), { code: 'ENOENT' })
    )
    await expect(f.facade().getWorkflowCaseCodePage(f.query)).rejects.toThrow('EXECUTION_NOT_FOUND')
  })
})
