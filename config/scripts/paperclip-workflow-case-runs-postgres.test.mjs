import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { createWorkflowCasePostgresFixture } from './paperclip-workflow-cases-postgres-fixture.mjs'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { createWorkflowDefinitionRepository } from '../../integration/paperclip/service/workflow-definition-repository.mjs'
import { createWorkflowCaseRepository } from '../../integration/paperclip/service/workflow-case-repository.mjs'
import { createWorkflowCaseRunRepository } from '../../integration/paperclip/service/workflow-case-run-repository.mjs'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { taskCommand } from '../../src/main/tasks/task-execution.test-fixture.ts'
import { computeTaskExecutionFingerprint } from '../../src/shared/task-execution/task-execution-fingerprint.ts'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)('real fixed workflow stage run admission', () => {
  let h, workbench, workflows, cases, runs
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
    workbench = createTeamWorkbenchRepository(h.sql)
    workflows = createWorkflowDefinitionRepository(h.sql)
    cases = createWorkflowCaseRepository(h.sql)
    runs = createWorkflowCaseRunRepository(h.sql)
  })
  afterAll(async () => h?.sql.end({ timeout: 5 }))
  async function fixture() {
    const f = await createWorkflowCasePostgresFixture({ workbench, workflows, cases })
    const { view } = await cases.createWorkflowCase(f.accountId, f.input)
    const task = view.stageTasks.find((stage) => stage.stageRef === view.currentStageRef)
    const start = {
      requestId: randomUUID(),
      projectId: f.project.id,
      caseId: view.id,
      expectedCaseRevision: view.revision,
      stageRef: task.stageRef,
      expectedTaskRevision: task.taskRevision
    }
    return { ...f, view, task, start }
  }
  async function counts(f) {
    const [row] = await h.sql`SELECT
      (SELECT count(*)::int FROM heartbeat_runs WHERE company_id=${f.company.id}) AS runs,
      (SELECT count(*)::int FROM issues WHERE company_id=${f.company.id}) AS issues,
      (SELECT count(*)::int FROM hive_task_accounts WHERE account_id=${f.accountId}) AS personal,
      (SELECT version FROM pipeline_cases WHERE id=${f.view.id}) AS revision`
    return row
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
        enforcementEvidenceRef: 'docker-enforcement:synthetic-db-fixture'
      }
    })
    return {
      bindingRef: `binding:${randomUUID()}`,
      paperclipCompanyId: f.company.id,
      paperclipAgentId: f.task.employeeRef,
      command,
      commandFingerprint: computeTaskExecutionFingerprint(command, 'trusted-local:runtime')
    }
  }
  it('binds and recovers an owned Case run without a personal company mapping', async () => {
    const f = await fixture(),
      admission = await runs.startWorkflowCase(f.accountId, f.start)
    const value = binding(f, admission),
      runId = admission.run.task.runId
    await h.repository.bind(f.accountId, f.task.taskId, runId, value)
    const proof = await h.repository.claimDelivery(
      f.accountId,
      f.task.taskId,
      runId,
      h.claimInput()
    )
    expect(await h.repository.getCurrentDelivery(f.accountId, f.company.id, runId)).toMatchObject({
      runId,
      taskId: f.task.taskId,
      companyId: f.company.id,
      generation: proof.generation
    })
    const page = await h.repository.listRecoverableRuns(f.accountId)
    expect(page.items.map((task) => task.run_id)).toEqual([runId])
    expect(page.items[0].agent_id).toBe(f.task.employeeRef)
    await h.repository.cancel(f.accountId, f.task.taskId, runId)
    await expect(
      h.repository.getCurrentDelivery(f.accountId, f.company.id, runId, 'start')
    ).rejects.toThrow('FORBIDDEN')
    expect(await h.repository.getCurrentDelivery(f.accountId, f.company.id, runId)).toMatchObject({
      runId,
      generation: proof.generation
    })
    expect(
      Number((await h.repository.read(f.accountId, f.task.taskId, runId)).status_version)
    ).toBe(2)
  })
  it('permits binding solely for cancellation after admission dependencies become unavailable', async () => {
    const f = await fixture(),
      admission = await runs.startWorkflowCase(f.accountId, f.start),
      runId = admission.run.task.runId
    await h.repository.cancel(f.accountId, f.task.taskId, runId)
    await h.sql`UPDATE companies SET status='paused' WHERE id=${f.company.id}`
    await h.sql`UPDATE agents SET status='paused' WHERE id=${f.task.employeeRef}`
    const task = await h.repository.bind(f.accountId, f.task.taskId, runId, binding(f, admission))
    expect(task.cancel_requested).toBe(true)
    expect(task.checkout_run_id).toBe(runId)
    const reply = await runs.getWorkflowCaseRunAdmission(f.accountId, {
      projectId: f.project.id,
      caseId: f.view.id,
      taskId: f.task.taskId,
      runId
    })
    expect(reply.run.startRequest).toEqual(f.start)
    expect(reply.run.status).toBe('cancelRequested')
    expect(task.run_status).toBe('queued')
  })
  it('reserves the original product Issue for its frozen employee, without creating personal entities', async () => {
    const f = await fixture()
    const reply = await runs.startWorkflowCase(f.accountId, f.start)
    expect(reply).toMatchObject({
      replayed: false,
      requestId: f.start.requestId,
      payloadFingerprint: digest({ operation: 'cases.start', input: f.start }),
      definitionDigest: f.view.definitionDigest,
      projectBindingRevision: f.view.projectBindingRevision,
      inputDigest: digest(reply.input),
      workspaceSelector: f.project.workspaceSelector,
      run: {
        caseId: f.view.id,
        stageRef: f.task.stageRef,
        role: 'product',
        employeeRef: f.task.employeeRef,
        task: { spaceId: f.company.id, taskId: f.task.taskId, attempt: 1, taskRevision: '1' },
        status: 'pending'
      }
    })
    expect(reply.input).toContain(f.view.requirement)
    expect(await counts(f)).toEqual({ runs: 1, issues: 5, personal: 0, revision: 2 })
    const task = await h.repository.read(f.accountId, f.task.taskId, reply.run.task.runId)
    expect(task).toMatchObject({
      company_id: f.company.id,
      agent_id: f.task.employeeRef,
      checkout_run_id: null,
      execution_run_id: reply.run.task.runId,
      status: 'todo',
      run_scope: {
        kind: 'workbenchCase',
        caseId: f.view.id,
        stageRef: f.task.stageRef,
        role: 'product'
      }
    })
    expect(Number(task.status_version)).toBe(1)
    expect(
      await runs.getWorkflowCaseRuns(f.accountId, { projectId: f.project.id, caseId: f.view.id })
    ).toEqual([reply.run])
  })
  it('serializes repeated requests and replays their frozen input after business content changes', async () => {
    const f = await fixture()
    const replies = await Promise.all(
      Array.from({ length: 6 }, () => runs.startWorkflowCase(f.accountId, f.start))
    )
    expect(replies.filter((reply) => !reply.replayed)).toHaveLength(1)
    expect(new Set(replies.map((reply) => reply.run.task.runId)).size).toBe(1)
    await h.sql`UPDATE issues SET description='Changed later requirement' WHERE id=${f.view.originTaskId}`
    const replay = await runs.startWorkflowCase(f.accountId, f.start)
    expect(replay.input).toBe(replies[0].input)
    expect(await counts(f)).toEqual({ runs: 1, issues: 5, personal: 0, revision: 2 })
    await expect(
      runs.startWorkflowCase(f.accountId, { ...f.start, expectedTaskRevision: 1 })
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  })
  it.each(['owner', 'caseRevision', 'taskRevision', 'stage'])(
    'rejects changed $0 before reserving any run',
    async (boundary) => {
      const f = await fixture(),
        before = await counts(f)
      const input = { ...f.start }
      if (boundary === 'caseRevision') {
        input.expectedCaseRevision += 1
      }
      if (boundary === 'taskRevision') {
        input.expectedTaskRevision += 1
      }
      if (boundary === 'stage') {
        input.stageRef = f.view.stageTasks[1].stageRef
      }
      await expect(
        runs.startWorkflowCase(
          boundary === 'owner' ? `foreign:${randomUUID()}` : f.accountId,
          input
        )
      ).rejects.toThrow()
      expect(await counts(f)).toEqual(before)
    }
  )
  it.each([
    'pausedCompany',
    'pausedAgent',
    'companyBudget',
    'agentBudget',
    'foreignCheckout',
    'foreignExecution'
  ])('retains original admission guard: %s', async (boundary) => {
    const f = await fixture()
    if (boundary === 'pausedCompany') {
      await h.sql`UPDATE companies SET status='paused' WHERE id=${f.company.id}`
    }
    if (boundary === 'pausedAgent') {
      await h.sql`UPDATE agents SET status='paused' WHERE id=${f.task.employeeRef}`
    }
    if (boundary === 'companyBudget') {
      await h.sql`UPDATE companies SET budget_monthly_cents=1,spent_monthly_cents=1 WHERE id=${f.company.id}`
    }
    if (boundary === 'agentBudget') {
      await h.sql`UPDATE agents SET budget_monthly_cents=1,spent_monthly_cents=1 WHERE id=${f.task.employeeRef}`
    }
    if (boundary === 'foreignCheckout' || boundary === 'foreignExecution') {
      const foreign = randomUUID()
      await h.sql`INSERT INTO heartbeat_runs(id,company_id,agent_id,status,invocation_source,driver_kind)
        VALUES(${foreign},${f.company.id},${f.task.employeeRef},'running','on_demand','hive_runtime')`
      if (boundary === 'foreignCheckout') {
        await h.sql`UPDATE issues SET checkout_run_id=${foreign} WHERE id=${f.task.taskId}`
      }
      if (boundary === 'foreignExecution') {
        await h.sql`UPDATE issues SET execution_run_id=${foreign} WHERE id=${f.task.taskId}`
      }
    }
    const before = await counts(f)
    await expect(runs.startWorkflowCase(f.accountId, f.start)).rejects.toThrow()
    expect(await counts(f)).toEqual(before)
  })
  it('does not release an active or cancel-pending attempt for another start request', async () => {
    const f = await fixture(),
      first = await runs.startWorkflowCase(f.accountId, f.start)
    await h.repository.cancel(f.accountId, f.task.taskId, first.run.task.runId)
    const current = await f.read(f.view.id)
    await expect(
      runs.startWorkflowCase(f.accountId, {
        ...f.start,
        requestId: randomUUID(),
        expectedCaseRevision: current.revision,
        expectedTaskRevision: current.stageTasks[0].taskRevision
      })
    ).rejects.toThrow()
    expect(await counts(f)).toEqual({ runs: 1, issues: 5, personal: 0, revision: 2 })
    expect((await runs.startWorkflowCase(f.accountId, f.start)).run.status).toBe('cancelRequested')
  })
  it('rolls back the reservation, Case version and audit if the original transaction fails', async () => {
    const f = await fixture(),
      before = await counts(f)
    const failing = createWorkflowCaseRunRepository({
      begin: (work) =>
        h.sql.begin(async (db) => {
          await work(db)
          throw new Error('Synthetic post-admission failure')
        })
    })
    await expect(failing.startWorkflowCase(f.accountId, f.start)).rejects.toThrow(
      'Synthetic post-admission failure'
    )
    expect(await counts(f)).toEqual(before)
    expect((await runs.startWorkflowCase(f.accountId, f.start)).replayed).toBe(false)
  })
})
