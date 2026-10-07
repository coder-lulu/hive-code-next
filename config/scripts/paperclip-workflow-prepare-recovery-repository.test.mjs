import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createTaskDispatchRecoveryRepository } from '../../integration/paperclip/service/task-dispatch-recovery-repository.mjs'

const ports = vi.hoisted(() => ({ readRun: vi.fn() }))
vi.mock('../../integration/paperclip/service/workflow-case-run-records.mjs', () => ({
  readWorkflowCaseRun: ports.readRun
}))
function fixture() {
  const id = randomUUID(),
    runId = randomUUID(),
    caseId = randomUUID(),
    projectId = randomUUID()
  const candidate = {
    id,
    run_id: runId,
    case_id: caseId,
    company_id: randomUUID(),
    agent_id: randomUUID(),
    binding: null,
    run_status: 'queued',
    cancel_requested: false,
    execution_stage: null
  }
  const task = { ...candidate, run_scope: { kind: 'workbenchCase', projectId, caseId } }
  let active = false,
    query,
    args
  const db = async (strings, ...values) => {
    query = strings.join('?')
    args = values
    return [candidate]
  }
  const sql = {
    begin: async (callback) => {
      active = true
      try {
        return await callback(db)
      } finally {
        active = false
      }
    }
  }
  const read = vi.fn(async () => task)
  ports.readRun.mockReset().mockImplementation(async (transaction) => {
    expect(transaction).toBe(db)
    expect(active).toBe(true)
    return {
      run: { status: 'pending' },
      input: { executionDeadlineAt: new Date(Date.now() + 60_000).toISOString() }
    }
  })
  return {
    candidate,
    task,
    read,
    db,
    repository: createTaskDispatchRecoveryRepository(sql, read),
    query: () => query,
    args: () => args,
    active: () => active
  }
}
describe('original bounded recovery query for committed null-binding admissions', () => {
  it('retains account/page limits and validates original workflow input inside the existing completed transaction', async () => {
    const f = fixture(),
      page = await f.repository.listRecoverableRuns('unit-account', { limit: 32 })
    expect(page.items[0].prepareRefs).toEqual({
      projectId: f.task.run_scope.projectId,
      caseId: f.task.case_id,
      taskId: f.task.id,
      runId: f.task.run_id
    })
    expect(f.query()).toContain('b.account_id=?')
    expect(f.query()).toContain('b.workflow_input IS NOT NULL')
    expect(f.query()).toContain("h.status='queued'")
    expect(f.query()).toContain("h.context_snapshot->'externalExecutionControl'->'cancel' IS NULL")
    expect(f.args()).toContain('unit-account')
    expect(f.args()).toContain(33)
    expect(f.read).toHaveBeenCalledWith(f.db, 'unit-account', f.task.id, f.task.run_id)
    expect(ports.readRun).toHaveBeenCalledOnce()
    expect(f.active()).toBe(false)
  })
  it('excludes a run that became cancelled after candidate selection', async () => {
    const f = fixture()
    f.task.cancel_requested = true
    expect((await f.repository.listRecoverableRuns('unit-account')).items).toEqual([])
  })
  it('excludes a run whose original admission is no longer pending', async () => {
    const f = fixture()
    ports.readRun.mockResolvedValueOnce({ run: { status: 'unknown' } })
    expect((await f.repository.listRecoverableRuns('unit-account')).items).toEqual([])
  })
  it('isolates an unavailable original Case and completes its page', async () => {
    const f = fixture()
    ports.readRun.mockRejectedValueOnce(
      Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT' })
    )
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await f.repository.listRecoverableRuns('unit-account')).toEqual({
        items: [],
        nextCursor: null
      })
      expect(diagnostic).toHaveBeenCalledWith(
        'HIVE_TASK_RECOVERY_UNAVAILABLE',
        f.task.run_id,
        'REVISION_CONFLICT'
      )
    } finally {
      diagnostic.mockRestore()
    }
    expect(f.active()).toBe(false)
  })
  it('propagates SQL/network failures instead of dropping their candidates', async () => {
    const f = fixture()
    ports.readRun.mockRejectedValueOnce(
      Object.assign(new Error('Connection failure'), { code: '08006' })
    )
    await expect(f.repository.listRecoverableRuns('unit-account')).rejects.toThrow(
      'Connection failure'
    )
    expect(f.active()).toBe(false)
  })
})
