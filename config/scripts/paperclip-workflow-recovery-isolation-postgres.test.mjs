import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { workflowStageAdmissionFixture } from './paperclip-workflow-stage-admission-postgres-fixture.mjs'
import { workflowConsumerDelivery } from './paperclip-workflow-consumer-postgres-fixture.mjs'
const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)(
  'unavailable Case isolation in the original bounded recovery page',
  () => {
    let h
    beforeAll(async () => {
      h = await createPostgresTaskHarness(configPath)
    })
    afterAll(async () => {
      await h?.sql.end({ timeout: 5 })
    })
    it('reports a retired first Case while the cursor reaches a healthy pending Case', async () => {
      const f = await workflowStageAdmissionFixture(h)
      const { view } = await f.cases.createWorkflowCase(f.accountId, {
        ...f.input,
        requestId: randomUUID()
      })
      const stage = view.stageTasks.find((t) => t.role === 'product')
      const second = await f.runs.startWorkflowCase(f.accountId, {
        requestId: randomUUID(),
        projectId: f.project.id,
        caseId: view.id,
        stageRef: stage.stageRef,
        expectedCaseRevision: view.revision,
        expectedTaskRevision: stage.taskRevision
      })
      const ordered = [f.first, second].toSorted((a, b) =>
        a.run.task.runId < b.run.task.runId ? -1 : 1
      )
      await h.sql`UPDATE pipeline_cases SET retired_at=now() WHERE id=${ordered[0].run.caseId}`
      const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const first = await h.repository.listRecoverableRuns(f.accountId, { limit: 1 })
        expect(first.items).toEqual([])
        expect(first.nextCursor).toBe(ordered[0].run.task.runId)
        expect(diagnostic).toHaveBeenCalledWith(
          'HIVE_TASK_RECOVERY_UNAVAILABLE',
          ordered[0].run.task.runId,
          'REVISION_CONFLICT'
        )
        const next = await h.repository.listRecoverableRuns(f.accountId, {
          limit: 1,
          after: first.nextCursor
        })
        expect(next.items).toHaveLength(1)
        expect(next.items[0].prepareRefs.runId).toBe(ordered[1].run.task.runId)
        expect(next.nextCursor).toBeNull()
      } finally {
        diagnostic.mockRestore()
      }
    })
    it('claims a still-current prepared Case through the original dispatch writer', async () => {
      const f = await workflowStageAdmissionFixture(h)
      const delivery = await workflowConsumerDelivery(h, f, f.first)
      await h.repository.claimDispatch(
        f.accountId,
        delivery.task.taskId,
        delivery.task.runId,
        delivery.token
      )
      const [run] =
        await h.sql`SELECT status,execution_stage FROM heartbeat_runs WHERE id=${delivery.task.runId}`
      expect(run).toEqual({ status: 'running', execution_stage: 'hive_dispatch' })
    })
    it('rechecks original Case version before claiming a previously prepared start', async () => {
      const f = await workflowStageAdmissionFixture(h)
      const delivery = await workflowConsumerDelivery(h, f, f.first)
      await h.sql`UPDATE pipeline_cases SET version=version+1,updated_at=now() WHERE id=${f.view.id}`
      await expect(
        h.repository.claimDispatch(
          f.accountId,
          delivery.task.taskId,
          delivery.task.runId,
          delivery.token
        )
      ).rejects.toThrow('REVISION_CONFLICT')
      const [run] =
        await h.sql`SELECT status,execution_stage FROM heartbeat_runs WHERE id=${delivery.task.runId}`
      expect(run).toEqual({ status: 'queued', execution_stage: null })
    })
  }
)
