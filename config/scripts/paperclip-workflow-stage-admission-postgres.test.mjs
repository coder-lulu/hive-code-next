import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import {
  workflowStageAdmissionFixture,
  closeWorkflowNativeFixture
} from './paperclip-workflow-stage-admission-postgres-fixture.mjs'
import { admitWorkflowCaseStageInTransaction } from '../../integration/paperclip/service/workflow-case-run-repository.mjs'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)('real original next-stage Case admission transactions', () => {
  let h
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
  })
  afterAll(async () => h?.sql.end({ timeout: 5 }))

  async function business(f) {
    return (await h.sql`SELECT version,updated_at FROM pipeline_cases WHERE id=${f.view.id}`)[0]
  }
  async function next(f, cause, role) {
    const before = await business(f)
    const admission = await f.admit(cause.run.task.runId, role)
    expect(await business(f)).toEqual(before)
    expect(admission.executionDeadlineAt).toBe(f.first.executionDeadlineAt)
    return admission
  }
  async function developer(f) {
    await closeWorkflowNativeFixture(h, f, f.first, { targetRole: 'developer' })
    return next(f, f.first, 'developer')
  }
  async function counts(f) {
    return (
      await h.sql`SELECT
      (SELECT count(*)::int FROM heartbeat_runs WHERE company_id=${f.company.id}) AS runs,
      (SELECT count(*)::int FROM hive_task_bindings WHERE account_id=${f.accountId}) AS bindings,
      (SELECT count(*)::int FROM hive_workflow_plan_intents WHERE case_id=${f.view.id}) AS intents,
      (SELECT count(*)::int FROM pipeline_case_events WHERE case_id=${f.view.id}) AS events`
    )[0]
  }

  it('inherits one absolute deadline and original requirement across Product, Developer, Tester and Ops', async () => {
    const f = await workflowStageAdmissionFixture(h)
    await h.sql`UPDATE issues SET description='Mutable later requirement' WHERE id=${f.view.originTaskId}`
    const dev = await developer(f)
    expect(dev.input).toContain(f.input.requirement)
    expect(dev.input).not.toContain('Mutable later requirement')
    const acceptedDev = await closeWorkflowNativeFixture(h, f, dev, { targetRole: 'tester' })
    const tester = await next(f, dev, 'tester')
    expect(tester.workflowContext.codeInput.version).toEqual(acceptedDev.asset.outcome.codeVersion)
    await closeWorkflowNativeFixture(h, f, tester, { targetRole: 'ops', decision: 'approved' })
    const ops = await next(f, tester, 'ops')
    expect(ops.workflowContext.codeInput).toEqual(tester.workflowContext.codeInput)
    expect((await f.read()).handoffs).toHaveLength(3)
    expect((await f.read()).reviews).toHaveLength(1)
  })

  it('keeps a failed native Tester negative review and returns to the same Developer Issue attempt 2', async () => {
    const f = await workflowStageAdmissionFixture(h),
      dev = await developer(f)
    await closeWorkflowNativeFixture(h, f, dev, { targetRole: 'tester' })
    const tester = await next(f, dev, 'tester')
    await closeWorkflowNativeFixture(h, f, tester, {
      status: 'failed',
      targetRole: 'developer',
      decision: 'changes_requested'
    })
    const returned = await next(f, tester, 'developer')
    expect(returned.run.task.taskId).toBe(dev.run.task.taskId)
    expect(returned.run.task.attempt).toBe(2)
    expect(returned.workflowContext.codeInput).toEqual(tester.workflowContext.codeInput)
    expect(returned.input).toContain('Accepted tester attempt 1')
    expect((await f.read()).reviews[0].decision).toBe('changes_requested')
  })

  it('concurrent admissions and replay reuse one immutable next run', async () => {
    const f = await workflowStageAdmissionFixture(h)
    await closeWorkflowNativeFixture(h, f, f.first, { targetRole: 'developer' })
    const before = await counts(f),
      original = await business(f)
    const results = await Promise.all([
      f.admit(f.first.run.task.runId, 'developer'),
      f.admit(f.first.run.task.runId, 'developer')
    ])
    expect(new Set(results.map((item) => item.run.task.runId)).size).toBe(1)
    expect(results.filter((item) => item.replayed)).toHaveLength(1)
    expect(await counts(f)).toEqual({
      runs: before.runs + 1,
      bindings: before.bindings + 1,
      intents: before.intents,
      events: before.events + 1
    })
    expect(await business(f)).toEqual(original)
    expect(await f.admit(f.first.run.task.runId, 'developer')).toEqual({
      ...results[0],
      replayed: true
    })
    await expect(f.admit(f.first.run.task.runId, 'tester')).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  })

  it('rolls back all original next-role writes with the caller transaction', async () => {
    const f = await workflowStageAdmissionFixture(h)
    await closeWorkflowNativeFixture(h, f, f.first, { targetRole: 'developer' })
    const view = await f.read(),
      before = await counts(f)
    const stage = view.stageTasks.find((item) => item.role === 'developer')
    await expect(
      h.sql.begin(async (db) => {
        await admitWorkflowCaseStageInTransaction(db, f.accountId, view, {
          causeRunId: f.first.run.task.runId,
          stageRef: stage.stageRef
        })
        throw new Error('caller_rollback')
      })
    ).rejects.toThrow('caller_rollback')
    expect(await counts(f)).toEqual(before)
    expect((await f.read()).stageTasks.find((item) => item.role === 'developer').status).toBe(
      'backlog'
    )
  })

  it('bounds stopped asset-only blocked retries by the original stage attempts', async () => {
    const f = await workflowStageAdmissionFixture(h)
    let previous = f.first
    const maxAttempts = f.workflow.definition.stages.find(
      (stage) => stage.role === 'product'
    ).maxAttempts
    for (let attempt = 1; attempt < maxAttempts; attempt++) {
      await closeWorkflowNativeFixture(h, f, previous, {
        status: attempt === 1 ? 'succeeded' : 'failed',
        assetOnly: true
      })
      previous = await next(f, previous, 'product')
      expect(previous.run.task.taskId).toBe(f.first.run.task.taskId)
      expect(previous.run.task.attempt).toBe(attempt + 1)
    }
    await closeWorkflowNativeFixture(h, f, previous, { status: 'failed', assetOnly: true })
    const before = await counts(f)
    await expect(f.admit(previous.run.task.runId, 'product')).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      reason: 'attempts_exhausted'
    })
    expect(await counts(f)).toEqual(before)
  })

  it('checks the first absolute deadline before writing a later-stage attempt', async () => {
    const f = await workflowStageAdmissionFixture(h, 1000)
    await closeWorkflowNativeFixture(h, f, f.first, { targetRole: 'developer' })
    await h.sql`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ${f.first.executionDeadlineAt}::timestamptz-clock_timestamp())))`
    const before = await counts(f),
      original = await business(f)
    await expect(f.admit(f.first.run.task.runId, 'developer')).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      reason: 'deadline_exceeded'
    })
    expect(await counts(f)).toEqual(before)
    expect(await business(f)).toEqual(original)
  })

  it('does not reuse a frozen employee after its actual project role binding is removed', async () => {
    const f = await workflowStageAdmissionFixture(h)
    await closeWorkflowNativeFixture(h, f, f.first, { targetRole: 'developer' })
    const before = await counts(f)
    await h.sql`DELETE FROM hive_workbench_employee_bindings WHERE project_id=${f.project.id} AND role='developer'`
    await expect(f.admit(f.first.run.task.runId, 'developer')).rejects.toThrow('REVISION_CONFLICT')
    expect(await counts(f)).toEqual(before)
  })

  it('rejects an unsettled prior writer even when its Issue appears blocked', async () => {
    const f = await workflowStageAdmissionFixture(h),
      dev = await developer(f)
    await closeWorkflowNativeFixture(h, f, dev, { assetOnly: true })
    await h.sql`UPDATE heartbeat_runs SET execution_stage='outcome_unknown' WHERE id=${dev.run.task.runId}`
    const before = await counts(f)
    await expect(f.admit(dev.run.task.runId, 'developer')).rejects.toThrow('REVISION_CONFLICT')
    expect(await counts(f)).toEqual(before)
  })
})
