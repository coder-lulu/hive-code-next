import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { workflowStageAdmissionFixture } from './paperclip-workflow-stage-admission-postgres-fixture.mjs'
import { workflowConsumerDelivery } from './paperclip-workflow-consumer-postgres-fixture.mjs'
const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)('original Case event notice projection on owned PostgreSQL', () => {
  let h
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
  })
  afterAll(async () => {
    await h?.sql.end({ timeout: 5 })
  })
  async function stoppedFixture() {
    const f = await workflowStageAdmissionFixture(h),
      d = await workflowConsumerDelivery(h, f, f.first)
    d.receipt.status = 'failed'
    d.receipt.artifactRefs = []
    d.receipt.stopProof.evidenceKind = 'not_started'
    d.observation.status = 'failed'
    d.observation.events[0].status = 'failed'
    d.observation.events[0].artifactRefs = []
    await h.repository.consumeObservation(
      f.accountId,
      d.task.taskId,
      d.task.runId,
      d.token,
      d.observation
    )
    return { f, d }
  }
  it('reads not-started from the original settled result while preserving native failure', async () => {
    const { f, d } = await stoppedFixture(),
      view = await f.read()
    expect(view.executionNotices).toHaveLength(1)
    expect(view.executionNotices[0]).toMatchObject({
      kind: 'workflow.case-execution-notice',
      reason: 'native_not_started',
      causeRunId: d.task.runId,
      stageRef: f.first.run.stageRef
    })
    expect(view.handoffs).toEqual([])
    expect(view.revision).toBe(1)
    expect(
      (
        await f.runs.getWorkflowCaseRuns(f.accountId, { projectId: f.project.id, caseId: view.id })
      )[0].status
    ).toBe('failed')
  })
  it('keeps a attempts-exhausted cause tied to the stopped original missing-report attempt', async () => {
    const f = await workflowStageAdmissionFixture(h)
    const limit = f.view.workflow.definition.stages.find(
      (stage) => stage.role === 'product'
    ).maxAttempts
    let admission = f.first,
      last
    for (let i = 0; i < limit; i++) {
      last = await workflowConsumerDelivery(h, f, admission, { missingReport: true })
      await last.consume()
      if (i + 1 < limit) {
        admission = await last.next('product')
      }
    }
    const view = await f.read()
    expect(view.executionNotices).toHaveLength(1)
    expect(view.executionNotices[0]).toMatchObject({
      reason: 'attempts_exhausted',
      causeRunId: last.task.runId,
      stageRef: admission.run.stageRef
    })
    expect(view.handoffs).toEqual([])
  })
  it.each(['actor', 'stage', 'reason', 'receipt', 'binding'])(
    'refuses a mismatched original %s instead of dropping the event',
    async (field) => {
      const { f, d } = await stoppedFixture()
      if (field === 'actor') {
        await h.sql`UPDATE pipeline_case_events SET actor_agent_id=${f.view.stageTasks.find((stage) => stage.role === 'tester').employeeRef}
    WHERE case_id=${f.view.id} AND payload->>'kind'='hive.workflow.stage_unavailable'`
      }
      if (field === 'stage') {
        await h.sql`UPDATE pipeline_case_events SET payload=jsonb_set(payload,'{stageRef}',${h.sql.json('stage:foreign')})
    WHERE case_id=${f.view.id} AND payload->>'kind'='hive.workflow.stage_unavailable'`
      }
      if (field === 'reason') {
        await h.sql`UPDATE pipeline_case_events SET payload=payload||' {"reason":"approved_by_model"}'::jsonb
    WHERE case_id=${f.view.id} AND payload->>'kind'='hive.workflow.stage_unavailable'`
      }
      if (field === 'receipt') {
        await h.sql`UPDATE heartbeat_runs SET result_json=jsonb_set(result_json,'{stopProof,evidenceKind}','"stopped"'::jsonb) WHERE id=${d.task.runId}`
      }
      if (field === 'binding') {
        await h.sql`UPDATE hive_task_bindings SET binding='{}'::jsonb WHERE run_id=${d.task.runId}`
      }
      await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
    }
  )
  it('does not project another Case event into the selected requirement', async () => {
    const { f } = await stoppedFixture()
    const { view } = await f.cases.createWorkflowCase(f.accountId, {
      ...f.input,
      requestId: randomUUID()
    })
    expect(
      (await f.cases.getWorkflowCase(f.accountId, { projectId: f.project.id, caseId: view.id }))
        .executionNotices
    ).toEqual([])
  })
  it('rejects a notice whose run has no original binding rather than omitting it from history', async () => {
    const { f } = await stoppedFixture()
    const runId = randomUUID()
    await h.sql`INSERT INTO heartbeat_runs(id,company_id,agent_id,status,invocation_source,driver_kind,execution_stage)
    VALUES(${runId},${f.company.id},${f.first.run.employeeRef},'failed','on_demand','hive_runtime','settled')`
    await h.sql`UPDATE pipeline_case_events SET run_id=${runId} WHERE case_id=${f.view.id}
    AND payload->>'kind'='hive.workflow.stage_unavailable'`
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })
})
