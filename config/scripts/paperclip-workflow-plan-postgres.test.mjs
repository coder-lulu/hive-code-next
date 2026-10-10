import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import {
  workflowStageAdmissionFixture,
  closeWorkflowNativeFixture
} from './paperclip-workflow-stage-admission-postgres-fixture.mjs'
import { admitWorkflowCaseStageInTransaction } from '../../integration/paperclip/service/workflow-case-run-repository.mjs'
import { workflowConsumerDelivery } from './paperclip-workflow-consumer-postgres-fixture.mjs'
import { workflowPlanProposalFixture } from '../../src/shared/task-workflow/workflow-plan-proposal.test-fixture.ts'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
function proposal(admission) {
  const value = workflowPlanProposalFixture(),
    facts = admission.workflowContext.planIntent.facts
  return {
    ...value,
    binding: facts.binding,
    goalRef: facts.goalRef,
    definitionDigest: facts.definitionDigest,
    planRevision: facts.planRevision,
    requestedLimits: {
      maxParallelism: facts.limits.maxParallelism,
      maxDurationMs: facts.limits.maxDurationMs
    }
  }
}
describe.skipIf(!configPath)(
  'immutable Product planning intent and original terminal draft transaction',
  () => {
    let h
    beforeAll(async () => {
      h = await createPostgresTaskHarness(configPath)
    })
    afterAll(async () => {
      await h?.sql.end({ timeout: 5 })
    })
    it('binds original goal and policy, refuses mutations, replays admission without another intent', async () => {
      const f = await workflowStageAdmissionFixture(h)
      const intent = f.first.workflowContext.planIntent
      expect(intent.facts).toMatchObject({
        goalRef: f.view.originTaskId,
        planRevision: 1,
        limits: { maxTasks: 32, maxAttempts: 3 }
      })
      expect(intent.sourceTask).toEqual(f.first.run.task)
      expect((await f.read()).planningIntent).toEqual(intent)
      for (const operation of ['UPDATE', 'DELETE']) {
        await expect(
          operation === 'UPDATE'
            ? h.sql`UPDATE hive_workflow_plan_intents SET plan_revision=2 WHERE run_id=${intent.sourceTask.runId}`
            : h.sql`DELETE FROM hive_workflow_plan_intents WHERE run_id=${intent.sourceTask.runId}`
        ).rejects.toThrow('immutable')
      }
      const replies = await Promise.all(
        Array.from({ length: 4 }, () =>
          f.runs.startWorkflowCase(f.accountId, f.first.run.startRequest)
        )
      )
      expect(
        replies.every(
          (item) =>
            item.replayed && digest(item.workflowContext) === digest(f.first.workflowContext)
        )
      ).toBe(true)
      expect(
        await h.sql`SELECT run_id FROM hive_workflow_plan_intents WHERE case_id=${f.view.id}`
      ).toHaveLength(1)
    })
    it.each(['validated', 'rejected', 'unavailable'])(
      'persists %s without adopting or changing the four-role successor',
      async (kind) => {
        const f = await workflowStageAdmissionFixture(h)
        const options =
          kind === 'unavailable'
            ? {}
            : { planText: kind === 'validated' ? JSON.stringify(proposal(f.first)) : '{' }
        const delivery = await workflowConsumerDelivery(h, f, f.first, options)
        await h.sql`UPDATE issues SET description='Changed current description' WHERE id=${f.view.originTaskId}`
        await delivery.consume()
        const view = await f.read()
        expect(view.planDrafts).toHaveLength(1)
        const draft = view.planDrafts[0]
        expect(draft.inspection.kind).toBe(kind)
        expect(draft.sourceInputDigest).toBe(f.first.inputDigest)
        expect(draft.intent).toEqual(f.first.workflowContext.planIntent)
        expect(view.currentStageRef).toBe(
          view.stageTasks.find((item) => item.role === 'developer').stageRef
        )
        expect(view.stageTasks).toHaveLength(4)
        await delivery.consume()
        expect((await f.read()).planDrafts).toEqual([draft])
      }
    )
    it('retains failed outcome and allocates retry intent independently of unchanged Case version', async () => {
      const f = await workflowStageAdmissionFixture(h)
      const delivery = await workflowConsumerDelivery(h, f, f.first, {
        status: 'failed',
        planText: '{'
      })
      await delivery.consume()
      const next = await delivery.next('product')
      const view = await f.read()
      expect(view.revision).toBe(f.view.revision)
      expect(next.workflowContext.planIntent.facts.planRevision).toBe(2)
      expect(next.workflowContext.planIntent.intentRef).not.toBe(
        f.first.workflowContext.planIntent.intentRef
      )
      expect(next.executionDeadlineAt).toBe(f.first.executionDeadlineAt)
      expect(view.planningIntent).toEqual(next.workflowContext.planIntent)
      expect(view.planDrafts[0].intent).toEqual(f.first.workflowContext.planIntent)
      expect(view.planDrafts[0].inspection.kind).toBe('rejected')
      expect(
        (
          await f.runs.getWorkflowCaseRuns(f.accountId, {
            projectId: f.project.id,
            caseId: f.view.id
          })
        ).find((item) => item.task.runId === f.first.run.task.runId).status
      ).toBe('failed')
    })
    it('rolls back a new retry intent with its caller, then uses the unconsumed next revision', async () => {
      const f = await workflowStageAdmissionFixture(h)
      await closeWorkflowNativeFixture(h, f, f.first, { status: 'failed', assetOnly: true })
      const view = await f.read()
      await expect(
        h.sql.begin(async (db) => {
          await admitWorkflowCaseStageInTransaction(db, f.accountId, view, {
            causeRunId: f.first.run.task.runId,
            stageRef: f.first.run.stageRef
          })
          throw new Error('Caller rollback')
        })
      ).rejects.toThrow('Caller rollback')
      expect(
        await h.sql`SELECT run_id FROM hive_workflow_plan_intents WHERE case_id=${view.id}`
      ).toHaveLength(1)
      expect(
        await h.sql`SELECT run_id FROM hive_task_bindings WHERE account_id=${f.accountId}`
      ).toHaveLength(1)
      const retry = await f.admit(f.first.run.task.runId, 'product')
      expect(retry.workflowContext.planIntent.facts.planRevision).toBe(2)
    })
    it('does not project a draft or reserve a successor when cancellation is pending', async () => {
      const f = await workflowStageAdmissionFixture(h)
      const delivery = await workflowConsumerDelivery(h, f, f.first, {
        planText: JSON.stringify(proposal(f.first))
      })
      await h.repository.cancel(f.accountId, f.first.run.task.taskId, f.first.run.task.runId)
      await delivery.consume()
      expect((await f.read()).planDrafts).toEqual([])
      expect(
        await h.sql`SELECT run_id FROM hive_workflow_plan_intents WHERE case_id=${f.view.id}`
      ).toHaveLength(1)
      expect(
        await h.sql`SELECT run_id FROM hive_task_bindings WHERE account_id=${f.accountId}`
      ).toHaveLength(1)
    })
    it('rolls back terminal native result and Case mutation on forged plan bytes', async () => {
      const f = await workflowStageAdmissionFixture(h)
      const delivery = await workflowConsumerDelivery(h, f, f.first, {
        planText: JSON.stringify(proposal(f.first))
      })
      delivery.delivery.artifacts.find((item) => item.name === 'plan-proposal.json').text = '{'
      await expect(delivery.consume()).rejects.toThrow('IDEMPOTENCY_CONFLICT')
      const view = await f.read()
      expect(view.planDrafts).toEqual([])
      expect(view.revision).toBe(f.view.revision)
      const [row] =
        await h.sql`SELECT result_receipt FROM hive_task_bindings WHERE run_id=${f.first.run.task.runId}`
      expect(row.result_receipt).toBeNull()
      expect(
        await h.sql`SELECT run_id FROM hive_workflow_plan_intents WHERE case_id=${view.id}`
      ).toHaveLength(1)
    })
  }
)
