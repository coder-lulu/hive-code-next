import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import * as graphContext from '../../src/shared/hive-workflow-plan-graph-context.ts'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { computeTaskExecutionFingerprint } from '../../src/shared/task-execution/task-execution-fingerprint.ts'
import { TaskExecutionStartSchema } from '../../src/shared/task-execution/task-execution-command.ts'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { createPlanApplicationPostgresFixture } from './paperclip-workflow-plan-application-postgres-fixture.mjs'
import { workflowConsumerDelivery } from './paperclip-workflow-consumer-postgres-fixture.mjs'
import { createWorkflowPlanApplicationRepository } from '../../integration/paperclip/service/workflow-plan-application-repository.mjs'
import { createWorkflowPlanGraphRepository } from '../../integration/paperclip/service/workflow-plan-graph-repository.mjs'

describe.skipIf(!process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG)(
  'adopted finite plan graph native control',
  () => {
    let h, applications, graphs
    beforeAll(async () => {
      h = await createPostgresTaskHarness(process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG)
      applications = createWorkflowPlanApplicationRepository(h.sql)
      graphs = createWorkflowPlanGraphRepository(h.sql)
    })
    afterAll(async () => {
      await h?.sql.end({ timeout: 5 })
    })
    async function fixture(
      transform = (p) => {
        delete p.resourceSelectionRefs
        delete p.requiredCoverage
        delete p.knowledgeRequirements
        delete p.requestedLimits.budget
        p.tasks = [
          ['build', 'developer', 'code', []],
          ['test', 'tester', 'test_report', ['build']],
          ['release', 'ops', 'release_plan', ['test']]
        ].map(([taskRef, requestedRole, outputKind, dependsOn]) => ({
          taskRef,
          title: taskRef,
          requestedRole,
          outputKind,
          dependsOn,
          acceptance: ['Produce verified native evidence'],
          maxAttempts: 3
        }))
      },
      maxParallelism = 1,
      requirement
    ) {
      const f = await createPlanApplicationPostgresFixture(
        h,
        true,
        false,
        transform,
        maxParallelism,
        requirement
      )
      const applied = await applications.applyWorkflowPlan(f.accountId, f.input),
        app = applied.view.application
      const query = {
        projectId: f.project.id,
        caseId: f.view.id,
        applicationRef: app.applicationRef
      }
      const start = {
        ...query,
        requestId: randomUUID(),
        expectedCaseRevision: f.view.revision,
        expectedProjectRevision: f.view.projectBindingRevision,
        draftDigest: app.draftDigest,
        proposalDigest: app.proposalDigest,
        requestedDurationMs: 60000
      }
      return { ...f, app, query, start }
    }
    it('starts actual mapped issues, advances exact reviewed dependencies, and leaves original Case unchanged', async () => {
      const f = await fixture(),
        before = await f.read()
      expect((await graphs.getWorkflowPlanGraph(f.accountId, f.query)).availability).toEqual({
        available: true
      })
      const [reply, replay] = await Promise.all([
        graphs.startWorkflowPlanGraph(f.accountId, f.start),
        graphs.startWorkflowPlanGraph(f.accountId, f.start)
      ])
      expect(replay.admission.replayed).toBe(true)
      expect(reply.view.runs).toHaveLength(1)
      expect(reply.view.graph.deadlineAt).not.toBe(f.first.executionDeadlineAt)
      expect((await graphs.startWorkflowPlanGraph(f.accountId, f.start)).admission.replayed).toBe(
        true
      )
      await expect(
        graphs.startWorkflowPlanGraph(f.accountId, { ...f.start, requestId: randomUUID() })
      ).rejects.toThrow('REVISION_CONFLICT')
      for (const role of ['developer', 'tester', 'ops']) {
        const view = await graphs.getWorkflowPlanGraph(f.accountId, f.query)
        const run = view.runs.find((item) => item.role === role)
        const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
          ...f.query,
          taskId: run.task.taskId,
          runId: run.task.runId
        })
        expect(
          (await h.repository.read(f.accountId, run.task.taskId, run.task.runId)).run_scope.kind
        ).toBe('workbenchPlan')
        expect(admission.executionDeadlineAt).toBe(reply.view.graph.deadlineAt)
        const delivery = await workflowConsumerDelivery(h, f, admission)
        await delivery.consume()
      }
      const final = await graphs.getWorkflowPlanGraph(f.accountId, f.query)
      expect(final.graph.status).toBe('done')
      expect(final.outcomes).toHaveLength(3)
      expect(final.tasks.every((task) => task.status === 'done')).toBe(true)
      expect(await f.read()).toEqual(before)
    })
    it('refuses unavailable resource policy before creating any graph or run', async () => {
      const f = await fixture(() => {})
      await expect(graphs.startWorkflowPlanGraph(f.accountId, f.start)).rejects.toThrow(
        'CAPABILITY_UNAVAILABLE'
      )
      expect((await graphs.getWorkflowPlanGraph(f.accountId, f.query)).graph).toBeNull()
    })
    it('reads and recovers the authenticated frozen bound input after the prompt template changes', async () => {
      const f = await fixture()
      const started = await graphs.startWorkflowPlanGraph(f.accountId, f.start)
      const run = started.view.runs[0]
      const query = { ...f.query, taskId: run.task.taskId, runId: run.task.runId }
      const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, query)
      await workflowConsumerDelivery(h, f, admission)
      const changed = vi
        .spyOn(graphContext, 'hiveWorkflowPlanGraphPrompt')
        .mockReturnValue('Changed completion template')
      try {
        expect((await graphs.getWorkflowPlanRunAdmission(f.accountId, query)).input).toBe(
          admission.input
        )
        expect(
          (await h.repository.listRecoverableRuns(f.accountId)).items.some(
            (item) => item.binding?.command.task.runId === run.task.runId
          )
        ).toBe(true)
      } finally {
        changed.mockRestore()
      }
    })
    it('still rejects an unbound admission after its prompt template changes', async () => {
      const f = await fixture()
      await graphs.startWorkflowPlanGraph(f.accountId, f.start)
      const changed = vi
        .spyOn(graphContext, 'hiveWorkflowPlanGraphPrompt')
        .mockReturnValue('Changed completion template')
      try {
        await expect(graphs.getWorkflowPlanGraph(f.accountId, f.query)).rejects.toThrow(
          'REVISION_CONFLICT'
        )
      } finally {
        changed.mockRestore()
      }
    })
    it('rejects bound input, context, source, task, workspace and fingerprint drift', async () => {
      const f = await fixture()
      const started = await graphs.startWorkflowPlanGraph(f.accountId, f.start)
      const run = started.view.runs[0]
      const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
        ...f.query,
        taskId: run.task.taskId,
        runId: run.task.runId
      })
      await workflowConsumerDelivery(h, f, admission)
      const [original] =
        await h.sql`SELECT binding,workflow_input FROM hive_task_bindings WHERE run_id=${run.task.runId}`
      const changes = [
        (row) => {
          row.workflow_input.input += ' changed'
          row.workflow_input.inputDigest = digest(row.workflow_input.input)
        },
        (row) => Object.assign(row.binding.command, { inputRef: `input:${'0'.repeat(64)}` }),
        (row) => Object.assign(row.binding.command, { workspaceRef: 'workspace:foreign' }),
        (row) => {
          row.binding.command.task.taskRevision += 1
        },
        (row) => {
          row.binding.command.workflowContext.employeeRef = 'employee:foreign'
        },
        (row) => {
          row.binding.command.workflowContext.planExecution.sourceTask.runId = randomUUID()
        },
        (row) => {
          row.workflow_input.workflowContext.binding.workflowRunRef = randomUUID()
          row.binding.command.workflowContext = structuredClone(row.workflow_input.workflowContext)
        },
        (row) => {
          row.workflow_input.workflowContext.planExecution.applicationRef = randomUUID()
          row.binding.command.workflowContext = structuredClone(row.workflow_input.workflowContext)
        }
      ]
      for (const change of changes) {
        const row = structuredClone(original)
        change(row)
        if (TaskExecutionStartSchema.safeParse(row.binding.command).success) {
          row.binding.commandFingerprint = computeTaskExecutionFingerprint(
            row.binding.command,
            'trusted-local:runtime'
          )
        }
        if (digest(row.workflow_input) !== digest(original.workflow_input)) {
          await expect(
            h.sql`UPDATE hive_task_bindings SET workflow_input=${h.sql.json(row.workflow_input)} WHERE run_id=${run.task.runId}`
          ).rejects.toThrow('immutable')
          continue
        }
        await h.sql`UPDATE hive_task_bindings SET binding=${h.sql.json(row.binding)},workflow_input=${h.sql.json(row.workflow_input)} WHERE run_id=${run.task.runId}`
        await expect(graphs.getWorkflowPlanGraph(f.accountId, f.query)).rejects.toThrow()
        await h.sql`UPDATE hive_task_bindings SET binding=${h.sql.json(original.binding)},workflow_input=${h.sql.json(original.workflow_input)} WHERE run_id=${run.task.runId}`
      }
      const altered = structuredClone(original.binding)
      altered.commandFingerprint = '0'.repeat(64)
      await h.sql`UPDATE hive_task_bindings SET binding=${h.sql.json(altered)} WHERE run_id=${run.task.runId}`
      await expect(graphs.getWorkflowPlanGraph(f.accountId, f.query)).rejects.toThrow(
        'REVISION_CONFLICT'
      )
      await h.sql`UPDATE hive_task_bindings SET binding=${h.sql.json(original.binding)} WHERE run_id=${run.task.runId}`
      expect((await graphs.getWorkflowPlanGraph(f.accountId, f.query)).runs).toHaveLength(1)
    })
    it('retains unbound queued occupancy on cancellation and refuses retry', async () => {
      const f = await fixture(),
        start = await graphs.startWorkflowPlanGraph(f.accountId, f.start)
      const input = {
        ...f.query,
        requestId: randomUUID(),
        graphRef: start.view.graph.graphRef,
        expectedGraphRevision: start.view.graph.revision
      }
      const cancelled = await graphs.cancelWorkflowPlanGraph(f.accountId, input)
      expect(cancelled.view.graph.status).toBe('cancel_requested')
      expect(cancelled.view.runs[0].status).toBe('cancelRequested')
      expect(cancelled.view.runs[0].hasResult).toBe(false)
      const run = cancelled.view.runs[0]
      const row = await h.repository.read(f.accountId, run.task.taskId, run.task.runId)
      expect(row.execution_run_id).toBe(run.task.runId)
      const recovered = await h.repository.listRecoverableRuns(f.accountId)
      expect(
        recovered.items.some((item) => item.prepareRefs?.applicationRef === f.app.applicationRef)
      ).toBe(true)
    })
    it('pauses rejected review without inventing a return edge or retry', async () => {
      const f = await fixture()
      await graphs.startWorkflowPlanGraph(f.accountId, f.start)
      for (const role of ['developer', 'tester']) {
        const view = await graphs.getWorkflowPlanGraph(f.accountId, f.query),
          run = view.runs.find((item) => item.role === role)
        const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
          ...f.query,
          taskId: run.task.taskId,
          runId: run.task.runId
        })
        const delivery = await workflowConsumerDelivery(
          h,
          f,
          admission,
          role === 'tester' ? { decision: 'rejected' } : {}
        )
        await delivery.consume()
      }
      const view = await graphs.getWorkflowPlanGraph(f.accountId, f.query)
      expect(view.graph.status).toBe('paused')
      expect(view.runs).toHaveLength(2)
      expect(view.tasks.find((task) => task.role === 'tester').blockedReason).toBe(
        'review_rejected'
      )
    })
    it('bounded manual retry waits fixed backoff, keeps deadline, and stops after three actual attempts', async () => {
      const f = await fixture(),
        first = await graphs.startWorkflowPlanGraph(f.accountId, f.start)
      for (let attempt = 1; attempt <= 3; attempt++) {
        const before = await graphs.getWorkflowPlanGraph(f.accountId, f.query),
          run = before.runs
            .filter((item) => item.role === 'developer')
            .sort((a, b) => b.task.attempt - a.task.attempt)[0]
        const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
          ...f.query,
          taskId: run.task.taskId,
          runId: run.task.runId
        })
        expect(admission.run.task.attempt).toBe(attempt)
        expect(admission.executionDeadlineAt).toBe(first.view.graph.deadlineAt)
        await (
          await workflowConsumerDelivery(h, f, admission, { status: 'failed', notStarted: true })
        ).consume()
        const paused = await graphs.getWorkflowPlanGraph(f.accountId, f.query)
        expect(paused.graph.status).toBe('paused')
        expect(paused.outcomes).toHaveLength(0)
        const retry = {
          ...f.query,
          requestId: randomUUID(),
          graphRef: paused.graph.graphRef,
          expectedGraphRevision: paused.graph.revision,
          taskId: run.task.taskId,
          causeRunId: run.task.runId,
          expectedTaskRevision: paused.tasks.find((item) => item.taskId === run.task.taskId)
            .taskRevision
        }
        await expect(graphs.retryWorkflowPlanTask(f.accountId, retry)).rejects.toThrow(
          'REVISION_CONFLICT'
        )
        await new Promise((resolve) => setTimeout(resolve, 1050))
        if (attempt === 3) {
          await expect(graphs.retryWorkflowPlanTask(f.accountId, retry)).rejects.toThrow(
            'OUTCOME_UNKNOWN'
          )
        } else {
          expect((await graphs.retryWorkflowPlanTask(f.accountId, retry)).view.runs).toHaveLength(
            attempt + 1
          )
        }
      }
    })
    it('persists real successful outcome racing cancellation and never advances', async () => {
      const f = await fixture(),
        started = await graphs.startWorkflowPlanGraph(f.accountId, f.start),
        run = started.view.runs[0]
      const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
        ...f.query,
        taskId: run.task.taskId,
        runId: run.task.runId
      })
      const delivery = await workflowConsumerDelivery(h, f, admission)
      await graphs.cancelWorkflowPlanGraph(f.accountId, {
        ...f.query,
        requestId: randomUUID(),
        graphRef: started.view.graph.graphRef,
        expectedGraphRevision: started.view.graph.revision
      })
      await delivery.consume()
      const after = await graphs.getWorkflowPlanGraph(f.accountId, f.query)
      expect(after.graph.status).toBe('cancelled')
      expect(after.outcomes).toHaveLength(1)
      expect(after.runs).toHaveLength(1)
    })
    it('rolls back partial downstream admission, preserves outcome, and explicitly resumes after a real Issue pause', async () => {
      const f = await fixture((p) => {
        delete p.resourceSelectionRefs
        delete p.requiredCoverage
        delete p.knowledgeRequirements
        delete p.requestedLimits.budget
        p.requestedLimits.maxParallelism = 2
        p.tasks = ['root', 'first', 'held'].map((taskRef) => ({
          taskRef,
          title: taskRef,
          requestedRole: 'product',
          outputKind: 'requirements',
          dependsOn: taskRef === 'root' ? [] : ['root'],
          acceptance: ['Produce requirements'],
          maxAttempts: 1
        }))
      }, 2)
      const started = await graphs.startWorkflowPlanGraph(f.accountId, f.start),
        run = started.view.runs[0]
      const held = started.view.tasks.find((task) => task.proposalTaskRef === 'held'),
        holdId = randomUUID()
      await h.sql`INSERT INTO issue_tree_holds(id,company_id,root_issue_id,mode,status,reason) VALUES(${holdId},${f.company.id},${held.taskId},'pause','active','Synthetic downstream pause')`
      const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
        ...f.query,
        taskId: run.task.taskId,
        runId: run.task.runId
      })
      await (await workflowConsumerDelivery(h, f, admission)).consume()
      const paused = await graphs.getWorkflowPlanGraph(f.accountId, f.query)
      expect(paused.graph.status).toBe('paused')
      expect(paused.runs).toHaveLength(1)
      expect(paused.outcomes).toHaveLength(1)
      expect(paused.graph.pauseCause).toMatchObject({
        kind: 'admission_unavailable',
        code: 'REVISION_CONFLICT',
        proposalTaskRef: 'held',
        causeRunId: run.task.runId
      })
      expect(
        (
          await h.sql`SELECT execution_run_id,checkout_run_id FROM issues WHERE id=ANY(${paused.tasks.filter((task) => task.proposalTaskRef !== 'root').map((task) => task.taskId)}::uuid[])`
        ).every((task) => task.execution_run_id === null && task.checkout_run_id === null)
      ).toBe(true)
      const resume = {
        ...f.query,
        requestId: randomUUID(),
        graphRef: paused.graph.graphRef,
        expectedGraphRevision: paused.graph.revision
      }
      await expect(graphs.resumeWorkflowPlanGraph(f.accountId, resume)).rejects.toThrow(
        'REVISION_CONFLICT'
      )
      await h.sql`DELETE FROM issue_tree_holds WHERE id=${holdId}`
      const resumed = await graphs.resumeWorkflowPlanGraph(f.accountId, resume)
      expect(resumed.view.runs).toHaveLength(3)
      expect(resumed.view.graph.pauseCause).toBeUndefined()
      expect(resumed.view.graph.deadlineAt).toBe(started.view.graph.deadlineAt)
      expect((await graphs.resumeWorkflowPlanGraph(f.accountId, resume)).admission.replayed).toBe(
        true
      )
    })
    it('settles 31 real Product outcomes and admits their large immutable fan-in prompt', async () => {
      const f = await fixture(
        (p) => {
          delete p.resourceSelectionRefs
          delete p.requiredCoverage
          delete p.knowledgeRequirements
          delete p.requestedLimits.budget
          p.requestedLimits = { maxParallelism: 4, maxDurationMs: 300000 }
          const refs = Array.from({ length: 31 }, (_, index) => `part-${index}`)
          p.tasks = [...refs, 'combined'].map((taskRef) => ({
            taskRef,
            title: taskRef,
            requestedRole: 'product',
            outputKind: 'requirements',
            dependsOn: taskRef === 'combined' ? refs : [],
            acceptance: ['Produce requirements'],
            maxAttempts: 1
          }))
        },
        4,
        'R'.repeat(48000)
      )
      await graphs.startWorkflowPlanGraph(f.accountId, { ...f.start, requestedDurationMs: 300000 })
      for (let index = 0; index < 31; index++) {
        const view = await graphs.getWorkflowPlanGraph(f.accountId, f.query),
          run = view.runs.find(
            (item) => item.status === 'pending' && item.proposalTaskRef !== 'combined'
          )
        const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
          ...f.query,
          taskId: run.task.taskId,
          runId: run.task.runId
        })
        await (
          await workflowConsumerDelivery(h, f, admission, { reportText: 'S'.repeat(2048) })
        ).consume()
      }
      const view = await graphs.getWorkflowPlanGraph(f.accountId, f.query),
        run = view.runs.find((item) => item.proposalTaskRef === 'combined')
      expect(view.outcomes).toHaveLength(31)
      expect(run.status).toBe('pending')
      const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
        ...f.query,
        taskId: run.task.taskId,
        runId: run.task.runId
      })
      expect(admission.input.length).toBeGreaterThan(128000)
      expect(admission.input.length).toBeLessThanOrEqual(512000)
      expect(admission.workflowContext.planExecution.dependencyOutcomes).toHaveLength(31)
    }, 180000)
    it('keeps another failed parallel task paused until its own explicit retry', async () => {
      const f = await fixture((p) => {
        delete p.resourceSelectionRefs
        delete p.requiredCoverage
        delete p.knowledgeRequirements
        delete p.requestedLimits.budget
        p.requestedLimits.maxParallelism = 2
        p.tasks = ['a', 'b'].map((taskRef) => ({
          taskRef,
          title: taskRef,
          requestedRole: 'product',
          outputKind: 'requirements',
          dependsOn: [],
          acceptance: ['Produce requirements'],
          maxAttempts: 2
        }))
      }, 2)
      const started = await graphs.startWorkflowPlanGraph(f.accountId, f.start)
      const deliveries = []
      for (const run of started.view.runs) {
        const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
          ...f.query,
          taskId: run.task.taskId,
          runId: run.task.runId
        })
        deliveries.push(
          await workflowConsumerDelivery(h, f, admission, { status: 'failed', notStarted: true })
        )
      }
      for (const delivery of deliveries) {
        await delivery.consume()
      }
      await new Promise((resolve) => setTimeout(resolve, 1050))
      for (const [index, original] of started.view.runs.entries()) {
        const view = await graphs.getWorkflowPlanGraph(f.accountId, f.query)
        expect(view.graph.status).toBe('paused')
        const retry = await graphs.retryWorkflowPlanTask(f.accountId, {
          ...f.query,
          requestId: randomUUID(),
          graphRef: view.graph.graphRef,
          expectedGraphRevision: view.graph.revision,
          taskId: original.task.taskId,
          causeRunId: original.task.runId,
          expectedTaskRevision: view.tasks.find((task) => task.taskId === original.task.taskId)
            .taskRevision
        })
        const run = retry.view.runs.find(
          (item) => item.task.taskId === original.task.taskId && item.task.attempt === 2
        )
        const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
          ...f.query,
          taskId: run.task.taskId,
          runId: run.task.runId
        })
        await (await workflowConsumerDelivery(h, f, admission)).consume()
        expect((await graphs.getWorkflowPlanGraph(f.accountId, f.query)).graph.status).toBe(
          index === 0 ? 'paused' : 'done'
        )
      }
    })
    it('settles expired unbound cancellation only through the original native not-started proof', async () => {
      const f = await fixture(),
        started = await graphs.startWorkflowPlanGraph(f.accountId, {
          ...f.start,
          requestedDurationMs: 1000
        }),
        run = started.view.runs[0]
      await new Promise((resolve) => setTimeout(resolve, 1050))
      await graphs.cancelWorkflowPlanGraph(f.accountId, {
        ...f.query,
        requestId: randomUUID(),
        graphRef: started.view.graph.graphRef,
        expectedGraphRevision: started.view.graph.revision
      })
      const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
        ...f.query,
        taskId: run.task.taskId,
        runId: run.task.runId
      })
      expect(admission.executionDeadlineAt).toBe(started.view.graph.deadlineAt)
      const proof = await workflowConsumerDelivery(h, f, admission, {
        status: 'failed',
        notStarted: true
      })
      await proof.consume()
      const after = await graphs.getWorkflowPlanGraph(f.accountId, f.query)
      expect(after.graph.status).toBe('cancelled')
      expect(after.outcomes).toHaveLength(0)
      expect(
        (await h.repository.read(f.accountId, run.task.taskId, run.task.runId)).execution_run_id
      ).toBeNull()
    })
    it('runs Product-only finite plans and keeps all four occupied slots including unknown', async () => {
      const f = await fixture((p) => {
        delete p.resourceSelectionRefs
        delete p.requiredCoverage
        delete p.knowledgeRequirements
        delete p.requestedLimits.budget
        p.requestedLimits.maxParallelism = 4
        p.tasks = Array.from({ length: 5 }, (_, i) => ({
          taskRef: `product-${i}`,
          title: `Product ${i}`,
          requestedRole: 'product',
          outputKind: 'requirements',
          dependsOn: [],
          acceptance: ['Produce requirements'],
          maxAttempts: 1
        }))
      }, 4)
      const started = await graphs.startWorkflowPlanGraph(f.accountId, f.start)
      expect(started.view.runs).toHaveLength(4)
      const first = started.view.runs[0]
      await h.sql`UPDATE heartbeat_runs SET execution_stage='outcome_unknown' WHERE id=${first.task.runId}`
      let view = await graphs.getWorkflowPlanGraph(f.accountId, f.query)
      expect(view.runs.filter((run) => run.status === 'unknown')).toHaveLength(1)
      expect(view.runs).toHaveLength(4)
      for (const run of started.view.runs.slice(1)) {
        const admission = await graphs.getWorkflowPlanRunAdmission(f.accountId, {
          ...f.query,
          taskId: run.task.taskId,
          runId: run.task.runId
        })
        await (await workflowConsumerDelivery(h, f, admission)).consume()
      }
      view = await graphs.getWorkflowPlanGraph(f.accountId, f.query)
      expect(view.runs).toHaveLength(5)
      expect(view.graph.status).toBe('running')
      expect(view.runs.find((run) => run.task.runId === first.task.runId).status).toBe('unknown')
    })
    it('preserves frozen deadline and rejects cross-account and heartbeat identity tampering', async () => {
      const f = await fixture(),
        started = await graphs.startWorkflowPlanGraph(f.accountId, f.start)
      await expect(graphs.getWorkflowPlanGraph('other-account', f.query)).rejects.toThrow(
        'FORBIDDEN'
      )
      await expect(
        h.sql`UPDATE hive_workflow_plan_graphs SET control_json=jsonb_set(control_json,'{maxDurationMs}','1000'::jsonb) WHERE graph_id=${started.view.graph.graphRef}`
      ).rejects.toThrow('immutable')
      const run = started.view.runs[0],
        other = f.view.team.employees.find((employee) => employee.role === 'ops')
      await h.sql`UPDATE heartbeat_runs SET agent_id=${other.employeeRef} WHERE id=${run.task.runId}`
      await expect(graphs.getWorkflowPlanGraph(f.accountId, f.query)).rejects.toThrow(
        'REVISION_CONFLICT'
      )
      await h.sql`UPDATE heartbeat_runs SET agent_id=${run.employeeRef} WHERE id=${run.task.runId}`
      expect((await graphs.getWorkflowPlanGraph(f.accountId, f.query)).graph.deadlineAt).toBe(
        started.view.graph.deadlineAt
      )
    })
  }
)
