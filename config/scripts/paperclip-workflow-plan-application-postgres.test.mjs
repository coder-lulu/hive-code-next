import { createPlanApplicationPostgresFixture } from './paperclip-workflow-plan-application-postgres-fixture.mjs'
import { randomUUID } from 'node:crypto'
import { verifyPlanApplicationSchema } from './paperclip-workflow-plan-application-schema-fixture.mjs'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import {
  createWorkflowPlanApplicationRepository,
  applyWorkflowPlanInTransaction
} from '../../integration/paperclip/service/workflow-plan-application-repository.mjs'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)('transactional original plan materialization', () => {
  let h, plans
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
    plans = createWorkflowPlanApplicationRepository(h.sql)
  })
  afterAll(async () => {
    await h?.sql.end({ timeout: 5 })
  })
  it('installs fresh bounded tables and composite provenance foreign keys', () =>
    verifyPlanApplicationSchema(h.sql))
  const fixture = (complete = true, failed = false) =>
    createPlanApplicationPostgresFixture(h, complete, failed)
  async function noApplication(f) {
    expect(
      await h.sql`SELECT application_id FROM hive_workflow_plan_applications WHERE case_id=${f.view.id}`
    ).toHaveLength(0)
    const children = await h.sql`SELECT id FROM issues WHERE parent_id=${f.view.originTaskId}`
    expect(children).toHaveLength(4)
  }
  it('creates one immutable blocked graph under concurrent requests and preserves the completed source', async () => {
    const f = await fixture()
    const before = await f.read()
    expect((await plans.getWorkflowPlanApplication(f.accountId, f.query)).eligibility).toEqual({
      available: true
    })
    const inputs = [
      f.input,
      f.input,
      { ...f.input, requestId: randomUUID() },
      { ...f.input, requestId: randomUUID() }
    ]
    const replies = await Promise.all(
      inputs.map((input) => plans.applyWorkflowPlan(f.accountId, input))
    )
    const receipt = replies[0].view.application
    expect(replies.every((reply) => digest(reply.view.application) === digest(receipt))).toBe(true)
    expect(replies.filter((reply) => !reply.admission.replayed)).toHaveLength(1)
    expect(receipt.createdTaskRefs).toHaveLength(2)
    expect(replies[0].view.taskStates.every((task) => task.status === 'blocked')).toBe(true)
    expect(await f.read()).toEqual(before)
    expect(
      await h.sql`SELECT run_id FROM hive_task_bindings WHERE account_id=${f.accountId}`
    ).toHaveLength(4)
    expect(
      (
        await h.sql`SELECT receipt_json,draft_json FROM hive_workflow_plan_applications WHERE case_id=${f.view.id}`
      )[0].draft_json
    ).toEqual(f.draft)
    for (const mapped of receipt.createdTaskRefs) {
      const [issue] = await h.sql`SELECT * FROM issues WHERE id=${mapped.taskId}`
      expect(issue).toMatchObject({
        parent_id: f.view.originTaskId,
        assignee_agent_id: mapped.employeeRef,
        execution_run_id: null,
        checkout_run_id: null
      })
      expect(
        await h.sql`SELECT id FROM pipeline_case_issue_links WHERE issue_id=${mapped.taskId}`
      ).toHaveLength(0)
      const edges =
        await h.sql`SELECT issue_id FROM issue_relations WHERE related_issue_id=${mapped.taskId}`
      expect(edges.map((edge) => edge.issue_id)).toEqual(mapped.dependsOnTaskIds)
    }
    await expect(
      plans.applyWorkflowPlan(f.accountId, {
        ...f.input,
        expectedCaseRevision: f.input.expectedCaseRevision + 1
      })
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    await h.sql`UPDATE pipeline_cases SET version=version+1 WHERE id=${f.view.id}`
    await h.sql`UPDATE hive_workbench_project_bindings SET binding_revision=binding_revision+1 WHERE project_id=${f.project.id}`
    await h.sql`UPDATE hive_workbench_employee_bindings SET binding_revision=binding_revision+1 WHERE project_id=${f.project.id}`
    expect((await plans.applyWorkflowPlan(f.accountId, f.input)).view.application).toEqual(receipt)
    for (const query of [
      h.sql`UPDATE hive_workflow_plan_applications SET draft_digest=${'a'.repeat(64)} WHERE case_id=${f.view.id}`,
      h.sql`DELETE FROM hive_workflow_plan_application_tasks WHERE application_id=${receipt.applicationRef}`,
      h.sql`DELETE FROM hive_workbench_request_receipts WHERE account_id=${f.accountId} AND request_id=${receipt.requestId}`
    ]) {
      await expect(query).rejects.toThrow('immutable')
    }
  })
  it.each(['case', 'project', 'digest', 'role', 'owner'])(
    'refuses stale or unauthorized %s without partial writes',
    async (kind) => {
      const f = await fixture()
      const input = { ...f.input }
      if (kind === 'case') {
        input.expectedCaseRevision++
      }
      if (kind === 'project') {
        input.expectedProjectRevision++
      }
      if (kind === 'digest') {
        input.draftDigest = 'f'.repeat(64)
      }
      if (kind === 'role') {
        await h.sql`UPDATE agents SET status='paused' WHERE id=${f.view.team.employees[0].employeeRef}`
      }
      if (kind === 'owner') {
        await h.sql`UPDATE hive_workbench_company_bindings SET owner_actor_ref='actor:revoked' WHERE company_id=${f.project.companyId}`
      }
      await expect(plans.applyWorkflowPlan(f.accountId, input)).rejects.toThrow()
      await noApplication(f)
    }
  )
  it.each(['queued', 'running', 'unknown', 'cancel_requested'])(
    'blocks a source Case with %s execution',
    async (kind) => {
      const f = await fixture(false)
      if (kind === 'running') {
        await h.sql`UPDATE heartbeat_runs SET status='running' WHERE id=${f.next.run.task.runId}`
      }
      if (kind === 'unknown') {
        await h.sql`UPDATE heartbeat_runs SET execution_stage='outcome_unknown' WHERE id=${f.next.run.task.runId}`
      }
      if (kind === 'cancel_requested') {
        await h.sql`UPDATE hive_task_bindings SET cancel_requested=true WHERE run_id=${f.next.run.task.runId}`
      }
      expect((await plans.getWorkflowPlanApplication(f.accountId, f.query)).eligibility).toEqual({
        available: false,
        reason: 'case_busy'
      })
      await expect(plans.applyWorkflowPlan(f.accountId, f.input)).rejects.toThrow(
        'REVISION_CONFLICT'
      )
      await noApplication(f)
    }
  )
  it('refuses an old valid draft after a newer original planning intent exists', async () => {
    const f = await fixture(false, true)
    expect((await f.read()).planningIntent.facts.planRevision).toBe(2)
    await expect(plans.applyWorkflowPlan(f.accountId, f.input)).rejects.toThrow('REVISION_CONFLICT')
    await noApplication(f)
  })
  it('refuses a cancelled Case', async () => {
    const f = await fixture()
    await h.sql`UPDATE pipeline_cases SET terminal_kind='cancelled',stage_id=(SELECT id FROM pipeline_stages WHERE pipeline_id=pipeline_cases.pipeline_id AND key='cancelled') WHERE id=${f.view.id}`
    expect((await plans.getWorkflowPlanApplication(f.accountId, f.query)).eligibility.reason).toBe(
      'case_cancelled'
    )
    await expect(plans.applyWorkflowPlan(f.accountId, f.input)).rejects.toThrow('REVISION_CONFLICT')
    await noApplication(f)
  })
  it('validates actual task assignments and dependency edges on replay', async () => {
    const f = await fixture()
    const result = await plans.applyWorkflowPlan(f.accountId, f.input)
    const [first, second] = result.view.application.createdTaskRefs
    await h.sql`UPDATE issues SET parent_id=NULL WHERE id=${first.taskId}`
    await expect(plans.applyWorkflowPlan(f.accountId, f.input)).rejects.toThrow('REVISION_CONFLICT')
    await h.sql`UPDATE issues SET parent_id=${f.view.originTaskId} WHERE id=${first.taskId}`
    await h.sql`DELETE FROM issue_relations WHERE issue_id=${first.taskId} AND related_issue_id=${second.taskId}`
    await expect(plans.applyWorkflowPlan(f.accountId, f.input)).rejects.toThrow('REVISION_CONFLICT')
  })
  it('rejects a forged persisted receipt even when its checksum is recomputed', async () => {
    const f = await fixture()
    const result = await plans.applyWorkflowPlan(f.accountId, f.input)
    const forged = { ...result.view.application, requestId: randomUUID() }
    await expect(
      h.sql.begin(async (db) => {
        await db`ALTER TABLE hive_workflow_plan_applications DISABLE TRIGGER hive_workflow_plan_applications_immutable`
        await db`UPDATE hive_workflow_plan_applications SET receipt_json=${db.json(forged)},receipt_digest=${digest(forged)} WHERE case_id=${f.view.id}`
        await applyWorkflowPlanInTransaction(db, f.accountId, f.input)
      })
    ).rejects.toThrow('REVISION_CONFLICT')
    expect((await plans.applyWorkflowPlan(f.accountId, f.input)).view.application).toEqual(
      result.view.application
    )
  })
  it('rolls back all adoption writes and counters with its caller transaction', async () => {
    const f = await fixture()
    const [before] =
      await h.sql`SELECT issue_counter FROM companies WHERE id=${f.project.companyId}`
    await expect(
      h.sql.begin(async (db) => {
        await applyWorkflowPlanInTransaction(db, f.accountId, f.input)
        throw new Error('Caller rollback')
      })
    ).rejects.toThrow('Caller rollback')
    await noApplication(f)
    expect(
      (await h.sql`SELECT issue_counter FROM companies WHERE id=${f.project.companyId}`)[0]
    ).toEqual(before)
    expect(
      await h.sql`SELECT request_id FROM hive_workbench_request_receipts WHERE account_id=${f.accountId} AND request_id=${f.input.requestId}`
    ).toHaveLength(0)
  })
})
