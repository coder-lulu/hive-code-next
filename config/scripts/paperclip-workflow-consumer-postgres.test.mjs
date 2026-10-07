import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { workflowStageAdmissionFixture } from './paperclip-workflow-stage-admission-postgres-fixture.mjs'
import { workflowConsumerDelivery } from './paperclip-workflow-consumer-postgres-fixture.mjs'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)('original native inbox and actual Case kernel transaction', () => {
  let h
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
  })
  afterAll(async () => {
    await h?.sql.end({ timeout: 5 })
  })
  async function advance(f, admission, nextRole, options) {
    const delivery = await workflowConsumerDelivery(h, f, admission, options)
    await delivery.consume()
    return nextRole ? delivery.next(nextRole) : delivery
  }
  async function testerFixture() {
    const f = await workflowStageAdmissionFixture(h)
    const dev = await advance(f, f.first, 'developer')
    const tester = await advance(f, dev, 'tester')
    return { f, dev, tester }
  }
  it('executes Product -> Developer -> Tester -> Ops -> done through the actual kernel', async () => {
    const { f, tester } = await testerFixture()
    const ops = await advance(f, tester, 'ops')
    const finish = await advance(f, ops)
    const view = await f.read()
    expect(view.terminalKind).toBe('done')
    expect(view.handoffs.map((item) => item.producer.role)).toEqual([
      'product',
      'developer',
      'tester'
    ])
    expect(view.reviews).toHaveLength(1)
    expect(view.reviews[0].decision).toBe('approved')
    expect(view.reviews[0].reviewer.employeeRef).not.toBe(view.handoffs[1].producer.employeeRef)
    const [events] = await h.sql`SELECT count(*)::int AS transitions FROM pipeline_case_events
      WHERE case_id=${f.view.id} AND type='transitioned'`
    expect(events.transitions).toBe(4)
    const before = view.revision
    await finish.consume()
    expect((await f.read()).revision).toBe(before)
    expect(
      await f.runs.getWorkflowCaseRuns(f.accountId, { projectId: f.project.id, caseId: f.view.id })
    ).toHaveLength(4)
  })
  it.each(['changes_requested', 'rejected'])(
    'keeps native failed evidence for %s and repairs/retests',
    async (decision) => {
      const { f, tester } = await testerFixture()
      const returned = await workflowConsumerDelivery(h, f, tester, { status: 'failed', decision })
      await returned.consume()
      const view = await f.read()
      expect(view.reviews[0].decision).toBe(decision)
      expect(view.currentStageRef).toBe(
        view.stageTasks.find((item) => item.role === 'developer').stageRef
      )
      expect(returned.delivery.asset.outcome.producer.status).toBe('failed')
      const repair = await returned.next('developer')
      expect(repair.run.task.attempt).toBe(2)
      expect(repair.executionDeadlineAt).toBe(f.first.executionDeadlineAt)
      const retest = await advance(f, repair, 'tester')
      expect(retest.run.task.attempt).toBe(2)
      expect(retest.workflowContext.codeInput.producer.task.runId).toBe(repair.run.task.runId)
      const ops = await advance(f, retest, 'ops')
      await advance(f, ops)
      expect((await f.read()).terminalKind).toBe('done')
    }
  )
  it.each([
    { noCommands: true },
    { testCommand: 'echo "1 passed"' },
    { testOutput: '# tests 0\n# pass 0\n' },
    { testOutput: '# tests 2\n# pass 1\n# fail 1\n' },
    { missingProposal: true },
    { reportText: '   \n ' },
    { status: 'failed', decision: 'approved' }
  ])('does not approve unsupported test evidence %j', async (options) => {
    const { f, tester } = await testerFixture()
    const delivery = await workflowConsumerDelivery(h, f, tester, options)
    await delivery.consume()
    const view = await f.read()
    expect(view.currentStageRef).toBe(tester.run.stageRef)
    expect(view.reviews).toEqual([])
    const retry = await delivery.next('tester')
    expect(retry.run.task.attempt).toBe(2)
    expect(retry.executionDeadlineAt).toBe(f.first.executionDeadlineAt)
  })
  it('rolls back original inbox, receipt, stage and next admission on altered report text', async () => {
    const f = await workflowStageAdmissionFixture(h)
    const delivery = await workflowConsumerDelivery(h, f, f.first)
    delivery.delivery.artifacts[0].text += ' altered'
    await expect(delivery.consume()).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    const [state] = await h.sql`SELECT b.result_receipt,d.event_cursor,
      (SELECT count(*)::int FROM hive_task_event_inbox WHERE run_id=${delivery.task.runId}) AS inbox
      FROM hive_task_bindings b JOIN hive_task_deliveries d ON d.run_id=b.run_id WHERE b.run_id=${delivery.task.runId}`
    expect(state).toMatchObject({ result_receipt: null, event_cursor: '0', inbox: 0 })
    expect((await f.read()).revision).toBe(1)
    expect((await f.read()).handoffs).toEqual([])
  })
  it('settles a real stopped missing report without fabricating a handoff and reserves a bounded retry', async () => {
    const f = await workflowStageAdmissionFixture(h)
    const delivery = await workflowConsumerDelivery(h, f, f.first, { missingReport: true })
    await delivery.consume()
    const view = await f.read()
    expect(view.revision).toBe(1)
    expect(view.handoffs).toEqual([])
    expect((await delivery.next('product')).run.task.attempt).toBe(2)
  })
  it('serializes simultaneous same-result consumers to one transition and successor', async () => {
    const f = await workflowStageAdmissionFixture(h)
    const delivery = await workflowConsumerDelivery(h, f, f.first)
    const results = await Promise.all(Array.from({ length: 4 }, () => delivery.consume()))
    expect(results.every((item) => item.settled)).toBe(true)
    const view = await f.read()
    expect(view.revision).toBe(2)
    expect(view.handoffs).toHaveLength(1)
    const runs = await f.runs.getWorkflowCaseRuns(f.accountId, {
      projectId: f.project.id,
      caseId: view.id
    })
    expect(runs).toHaveLength(2)
    expect(
      runs.filter((item) => item.role === 'developer' && item.status === 'pending')
    ).toHaveLength(1)
  })
  it('refuses an expired delivery without storing inbox or business changes', async () => {
    const f = await workflowStageAdmissionFixture(h)
    const delivery = await workflowConsumerDelivery(h, f, f.first)
    await h.sql`UPDATE hive_task_deliveries SET expires_at=clock_timestamp()-interval '1 second' WHERE run_id=${delivery.task.runId}`
    await expect(delivery.consume()).rejects.toThrow('OUTCOME_UNKNOWN')
    expect((await f.read()).revision).toBe(1)
    expect(
      (await h.repository.read(f.accountId, delivery.task.taskId, delivery.task.runId))
        .result_receipt
    ).toBeNull()
  })
  it('settles a cancellation without handoff, review, transition or successor', async () => {
    const f = await workflowStageAdmissionFixture(h)
    const delivery = await workflowConsumerDelivery(h, f, f.first)
    await h.repository.cancel(f.accountId, delivery.task.taskId, delivery.task.runId)
    const result = await delivery.consume()
    expect(result.settled).toBe(true)
    expect((await f.read()).handoffs).toEqual([])
    expect((await f.read()).revision).toBe(1)
    expect(
      await f.runs.getWorkflowCaseRuns(f.accountId, { projectId: f.project.id, caseId: f.view.id })
    ).toHaveLength(1)
  })
  it('preserves native not-started failure as unavailable without inventing an asset or retry', async () => {
    const f = await workflowStageAdmissionFixture(h)
    const delivery = await workflowConsumerDelivery(h, f, f.first)
    delivery.receipt.status = 'failed'
    delivery.receipt.artifactRefs = []
    delivery.receipt.stopProof.evidenceKind = 'not_started'
    delivery.observation.status = 'failed'
    delivery.observation.events[0].status = 'failed'
    delivery.observation.events[0].artifactRefs = []
    await h.repository.consumeObservation(
      f.accountId,
      delivery.task.taskId,
      delivery.task.runId,
      delivery.token,
      delivery.observation
    )
    expect((await f.read()).handoffs).toEqual([])
    expect((await f.read()).revision).toBe(1)
    const [event] = await h.sql`SELECT payload FROM pipeline_case_events WHERE case_id=${f.view.id}
      AND payload->>'kind'='hive.workflow.stage_unavailable'`
    expect(event.payload.reason).toBe('native_not_started')
    expect(
      await f.runs.getWorkflowCaseRuns(f.accountId, { projectId: f.project.id, caseId: f.view.id })
    ).toHaveLength(1)
  })
  it('ends bounded missing-report attempts in an explicit blocked state', async () => {
    const f = await workflowStageAdmissionFixture(h)
    const limit = f.view.workflow.definition.stages.find(
      (item) => item.role === 'product'
    ).maxAttempts
    let admission = f.first
    for (let index = 0; index < limit; index++) {
      const delivery = await workflowConsumerDelivery(h, f, admission, { missingReport: true })
      await delivery.consume()
      if (index + 1 < limit) {
        admission = await delivery.next('product')
      }
    }
    const view = await f.read()
    expect(view.revision).toBe(1)
    expect(view.stageTasks.find((item) => item.role === 'product').status).toBe('blocked')
    const records = await f.runs.getWorkflowCaseRuns(f.accountId, {
      projectId: f.project.id,
      caseId: view.id
    })
    expect(records).toHaveLength(limit)
    expect(records.every((item) => item.status === 'succeeded')).toBe(true)
    const [event] = await h.sql`SELECT payload FROM pipeline_case_events WHERE case_id=${view.id}
      AND payload->>'kind'='hive.workflow.admission_blocked'`
    expect(event.payload.reason).toBe('attempts_exhausted')
  })
  it('retains a valid negative review when returned developer attempts are exhausted', async () => {
    const { f, tester } = await testerFixture()
    const limit = f.view.workflow.definition.stages.find(
      (item) => item.role === 'developer'
    ).maxAttempts
    let admission = tester
    for (let index = 0; index < limit; index++) {
      const delivery = await workflowConsumerDelivery(h, f, admission, {
        status: 'failed',
        decision: 'changes_requested'
      })
      await delivery.consume()
      if (index + 1 < limit) {
        const repair = await delivery.next('developer')
        admission = await advance(f, repair, 'tester')
      }
    }
    const view = await f.read()
    expect(view.reviews).toHaveLength(limit)
    expect(view.currentStageRef).toBe(
      view.stageTasks.find((item) => item.role === 'developer').stageRef
    )
    const [event] = await h.sql`SELECT payload FROM pipeline_case_events WHERE case_id=${view.id}
      AND payload->>'kind'='hive.workflow.admission_blocked'`
    expect(event.payload.reason).toBe('attempts_exhausted')
  })
})
