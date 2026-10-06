import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { workflowTestVectors } from '../../src/shared/task-workflow/workflow.test-fixture.ts'
import { HiveWorkflowCaseCreateReplySchema } from '../../src/shared/hive-workflow-cases.ts'
import {
  HiveWorkflowCaseRunAdmissionSchema,
  HiveWorkflowCaseRunsSchema
} from '../../src/shared/hive-workflow-case-runs.ts'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { createTaskRepository } from '../../integration/paperclip/service/task-repository.mjs'
import { taskCommand } from '../../src/main/tasks/task-execution.test-fixture.ts'
import { computeTaskExecutionFingerprint } from '../../src/shared/task-execution/task-execution-fingerprint.ts'

describe.skipIf(!process.env.HIVE_PAPERCLIP_TEST_CONFIG)(
  'real Case run HTTP admission and delivery boundaries',
  () => {
    let sql, repository, descriptor, company, project, workflow
    const account = `workflow-case-run-http:${randomUUID()}`
    const denied = { status: 403, body: { error: { code: 'FORBIDDEN' } } }

    beforeAll(async () => {
      const config = JSON.parse(
        await readFile(resolve(process.env.HIVE_PAPERCLIP_TEST_CONFIG), 'utf8')
      )
      const database = new URL(config.databaseUrl)
      if (
        config.containerName !== 'hive-paperclip-p1-p2-validation-d2861510ba' ||
        !['postgres:', 'postgresql:'].includes(database.protocol) ||
        database.hostname !== '127.0.0.1' ||
        database.port !== '52054' ||
        database.pathname !== '/hive_tasks'
      ) {
        throw new Error('Owned dedicated loopback PostgreSQL is required')
      }
      const requireDb = createRequire(
        resolve('logs/paperclip-p1/paperclip/packages/db/package.json')
      )
      sql = requireDb('postgres')(config.databaseUrl, {
        max: 4,
        onnotice: () => {},
        connection: { statement_timeout: 12_000, idle_in_transaction_session_timeout: 15_000 }
      })
      repository = createTaskRepository(sql)
      descriptor = JSON.parse(await readFile(config.serviceDescriptor, 'utf8'))
      const service = new URL(descriptor.baseUrl)
      if (service.protocol !== 'http:' || service.hostname !== '127.0.0.1') {
        throw new Error('Owned dedicated loopback service is required')
      }
      const created = await workbench('companies/create', {
        requestId: randomUUID(),
        name: 'Case run HTTP fixture'
      })
      expect(created.status).toBe(201)
      company = created.body
      const projected = await workbench('projects/create', {
        requestId: randomUUID(),
        companyId: company.id,
        name: 'Case run HTTP project',
        workspaceSelector: 'folder:case-run-http',
        hiveWorkspaceRef: 'workspace:case-run-http'
      })
      expect(projected.status).toBe(201)
      project = projected.body
      expect(
        (
          await workbench('team/configure', {
            requestId: randomUUID(),
            projectId: project.id,
            expectedRevision: 1,
            employees: ['product', 'developer', 'tester', 'ops'].map((role) => ({
              role,
              name: role,
              profileRef: 'codex',
              profileRevision: 'codex:1'
            }))
          })
        ).status
      ).toBe(200)
      const saved = await workbench('workflows/save', {
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: 0,
        expectedProjectRevision: 2,
        name: 'Case run HTTP fixed workflow',
        stages: structuredClone(workflowTestVectors.examples.definition.stages),
        maxParallelism: 1,
        maxDurationMs: 60_000
      })
      expect(saved.status).toBe(200)
      workflow = saved.body
    })
    afterAll(async () => sql?.end({ timeout: 5 }))

    async function request(path, body, identity = account) {
      const response = await fetch(`${descriptor.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${descriptor.secret}`,
          'Content-Type': 'application/json',
          'X-Hive-Account-Id': identity
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000)
      })
      return { status: response.status, body: await response.json() }
    }
    const workbench = (path, body, identity) => request(`/hive/workbench/${path}`, body, identity)
    async function fixture() {
      const created = await workbench('cases/create', {
        requestId: randomUUID(),
        projectId: project.id,
        workflowId: workflow.workflowId,
        workflowRevision: 1,
        definitionDigest: workflow.definitionDigest,
        expectedProjectRevision: 2,
        title: 'HTTP Case run',
        requirement: 'Prepare independent requirements and test evidence.'
      })
      expect(created.status).toBe(201)
      const { view } = HiveWorkflowCaseCreateReplySchema.parse(created.body)
      const stage = view.stageTasks.find((task) => task.stageRef === view.currentStageRef)
      return {
        view,
        stage,
        start: {
          requestId: randomUUID(),
          projectId: project.id,
          caseId: view.id,
          expectedCaseRevision: view.revision,
          stageRef: stage.stageRef,
          expectedTaskRevision: stage.taskRevision
        }
      }
    }
    async function counts(f) {
      const [row] = await sql`SELECT
      (SELECT count(*) FROM heartbeat_runs WHERE company_id=${company.id}) AS runs,
      (SELECT count(*) FROM issues WHERE company_id=${company.id}) AS issues,
      (SELECT count(*) FROM hive_task_bindings b JOIN hive_workflow_case_stage_issues s ON s.issue_id=b.task_id
        WHERE s.case_id=${f.view.id}) AS bindings,
      (SELECT count(*) FROM hive_task_accounts WHERE account_id=${account}) AS personal,
      (SELECT version FROM pipeline_cases WHERE id=${f.view.id}) AS revision`
      return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]))
    }
    const readQuery = (f, admission) => ({
      projectId: project.id,
      caseId: f.view.id,
      taskId: admission.run.task.taskId,
      runId: admission.run.task.runId
    })
    async function start(f) {
      const result = await workbench('cases/start', f.start)
      expect(result.status).toBe(200)
      return HiveWorkflowCaseRunAdmissionSchema.parse(result.body)
    }
    function binding(f, admission) {
      const command = taskCommand({
        profileId: 'codex',
        profileRevision: 'codex:1',
        task: admission.run.task,
        ownerScope: f.view.team.company.ownerScope,
        workspaceRef: f.view.team.project.hiveWorkspaceRef,
        inputRef: `input:${admission.inputDigest}`,
        executionDeadlineAt: admission.executionDeadlineAt,
        executionPolicy: {
          trustMode: 'enforced_autonomous',
          executionPolicyRef: 'docker-local-linux',
          executionPolicyRevision: '1',
          enforcementEvidenceRef: 'synthetic:http-database-boundary'
        }
      })
      return {
        bindingRef: `binding:${randomUUID()}`,
        paperclipCompanyId: company.id,
        paperclipAgentId: f.stage.employeeRef,
        command,
        commandFingerprint: computeTaskExecutionFingerprint(command, 'trusted-local:runtime')
      }
    }
    async function boundDelivery(f, admission) {
      const task = admission.run.task
      const bound = await request(
        `/hive/tasks/${task.taskId}/runs/${task.runId}/binding`,
        binding(f, admission)
      )
      expect(bound.status).toBe(200)
      const proof = await repository.claimDelivery(account, task.taskId, task.runId, {
        ownerId: `http-fixture:${randomUUID()}`,
        leaseRef: `delivery:${randomUUID()}`,
        expectedGeneration: 0,
        leaseMs: 30_000
      })
      return { task, proof, delivery: `/hive/execution-delivery/${company.id}/${task.runId}` }
    }
    async function requireQueued(admission) {
      const [row] = await sql`SELECT status,driver_kind,started_at,finished_at FROM heartbeat_runs
      WHERE id=${admission.run.task.runId}`
      expect(row).toEqual({
        status: 'queued',
        driver_kind: 'hive_runtime',
        started_at: null,
        finished_at: null
      })
    }

    it('replays a real Case start against the same fixed Issue and one original queued run', async () => {
      const f = await fixture(),
        before = await counts(f)
      const first = await start(f)
      expect(first).toMatchObject({
        requestId: f.start.requestId,
        replayed: false,
        payloadFingerprint: digest({ operation: 'cases.start', input: f.start }),
        inputDigest: digest(first.input),
        run: {
          caseId: f.view.id,
          stageRef: f.stage.stageRef,
          role: 'product',
          employeeRef: f.stage.employeeRef,
          startRequest: f.start,
          task: { spaceId: company.id, taskId: f.stage.taskId, taskRevision: '1' },
          status: 'pending'
        }
      })
      const repeated = await Promise.all(
        Array.from({ length: 3 }, () => workbench('cases/start', f.start))
      )
      for (const replay of repeated) {
        expect(replay).toEqual({ status: 200, body: { ...first, replayed: true } })
      }
      expect(await counts(f)).toEqual({
        ...before,
        runs: before.runs + 1,
        bindings: 1,
        revision: before.revision + 1
      })
      await requireQueued(first)
    })

    it('recovers startRequest from the real run listing and replays its frozen admission input', async () => {
      const f = await fixture(),
        first = await start(f)
      await sql`UPDATE issues SET description='Changed live requirement after admission' WHERE id=${f.view.originTaskId}`
      const listed = await workbench('cases/runs', { projectId: project.id, caseId: f.view.id })
      expect(listed.status).toBe(200)
      const [run] = HiveWorkflowCaseRunsSchema.parse(listed.body)
      expect(run.startRequest).toEqual(f.start)
      expect(run.task).toEqual(first.run.task)
      const restored = await workbench('cases/start', run.startRequest)
      expect(restored).toEqual({ status: 200, body: { ...first, replayed: true } })
      expect(await workbench('cases/run-read', readQuery(f, first))).toEqual({
        status: 200,
        body: { ...first, replayed: true }
      })
      await requireQueued(first)
    })

    it('rejects cross-account start, listing, private read and original task access without reserving another run', async () => {
      const f = await fixture(),
        foreign = `foreign:${randomUUID()}`,
        before = await counts(f)
      expect(await workbench('cases/start', f.start, foreign)).toEqual(denied)
      expect(await counts(f)).toEqual(before)
      const first = await start(f),
        admitted = await counts(f)
      expect(await workbench('cases/start', f.start, foreign)).toEqual(denied)
      expect(
        await workbench('cases/runs', { projectId: project.id, caseId: f.view.id }, foreign)
      ).toEqual(denied)
      expect(await workbench('cases/run-read', readQuery(f, first), foreign)).toEqual(denied)
      expect(
        await request(
          `/hive/tasks/${first.run.task.taskId}/runs/${first.run.task.runId}`,
          undefined,
          foreign
        )
      ).toEqual(denied)
      expect(await counts(f)).toEqual(admitted)
    })

    it.each(['projectId', 'caseId', 'taskId', 'runId'])(
      'rejects a private run-read %s tuple mismatch',
      async (field) => {
        const f = await fixture(),
          first = await start(f),
          before = await counts(f)
        expect(
          await workbench('cases/run-read', { ...readQuery(f, first), [field]: randomUUID() })
        ).toEqual(denied)
        expect(await counts(f)).toEqual(before)
      }
    )

    it('reads a cancel-pending admission before binding and denies start delivery while retaining observation', async () => {
      const f = await fixture(),
        first = await start(f),
        task = first.run.task
      const cancel = await request(`/hive/tasks/${task.taskId}/runs/${task.runId}/cancel`, {})
      expect(cancel.status).toBe(202)
      expect(cancel.body).toMatchObject({
        binding: null,
        cancel_requested: true,
        checkout_run_id: null
      })
      const read = await workbench('cases/run-read', readQuery(f, first))
      expect(read.status).toBe(200)
      expect(read.body).toMatchObject({
        ...first,
        replayed: true,
        run: { ...first.run, status: 'cancelRequested' }
      })
      const { proof, delivery } = await boundDelivery(
        f,
        HiveWorkflowCaseRunAdmissionSchema.parse(read.body)
      )
      expect(await request(`${delivery}/start`)).toEqual(denied)
      const observed = await request(delivery)
      expect(observed.status).toBe(200)
      expect(observed.body).toMatchObject({
        accountId: account,
        companyId: company.id,
        taskId: task.taskId,
        runId: task.runId,
        generation: proof.generation,
        leaseRef: proof.leaseRef,
        cursor: 0
      })
      await requireQueued(first)
      const current = await request(`/hive/tasks/${task.taskId}/runs/${task.runId}`)
      expect(current.body).toMatchObject({
        cancel_requested: true,
        checkout_run_id: task.runId,
        result_receipt: null
      })
    })

    it('uses the original delivery proof for start and observation, with foreign accounts denied', async () => {
      const f = await fixture(),
        first = await start(f),
        { proof, delivery } = await boundDelivery(f, first)
      for (const path of [delivery, `${delivery}/start`]) {
        const result = await request(path)
        expect(result.status).toBe(200)
        expect(result.body).toMatchObject({
          commandFingerprint: proof.commandFingerprint,
          taskId: f.stage.taskId,
          runId: first.run.task.runId,
          generation: proof.generation,
          ownerId: proof.ownerId
        })
        expect(await request(path, undefined, `foreign:${randomUUID()}`)).toEqual(denied)
      }
      await requireQueued(first)
    })
  }
)
