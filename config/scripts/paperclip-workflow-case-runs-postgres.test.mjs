import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { createWorkflowCasePostgresFixture } from './paperclip-workflow-cases-postgres-fixture.mjs'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { createWorkflowDefinitionRepository } from '../../integration/paperclip/service/workflow-definition-repository.mjs'
import { createWorkflowCaseRepository } from '../../integration/paperclip/service/workflow-case-repository.mjs'
import { createWorkflowCaseRunRepository } from '../../integration/paperclip/service/workflow-case-run-repository.mjs'
import { createTaskRunScopeReader } from '../../integration/paperclip/service/task-run-scope.mjs'
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
      workflowContext: admission.workflowContext,
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
    expect(await counts(f)).toEqual({ runs: 1, issues: 5, personal: 0, revision: 1 })
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
    expect(await counts(f)).toEqual({ runs: 1, issues: 5, personal: 0, revision: 1 })
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
    expect(await counts(f)).toEqual({ runs: 1, issues: 5, personal: 0, revision: 1 })
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
  it('preserves the original business version, timestamp and unresolved drift on admission', async () => {
    const f = await fixture()
    const [before] =
      await h.sql`SELECT version,updated_at FROM pipeline_cases WHERE id=${f.view.id}`
    await h.sql`INSERT INTO pipeline_case_events(company_id,case_id,type,actor_type,payload,created_at)
      VALUES(${f.company.id},${f.view.id},'upstream_drift','system','{}'::jsonb,clock_timestamp())`
    const admission = await runs.startWorkflowCase(f.accountId, f.start)
    const [after] = await h.sql`SELECT c.version,c.updated_at,EXISTS(
      SELECT 1 FROM pipeline_case_events e WHERE e.case_id=c.id AND e.type='upstream_drift'
        AND e.created_at>c.updated_at) AS unresolved FROM pipeline_cases c WHERE c.id=${f.view.id}`
    expect(after).toEqual({ ...before, unresolved: true })
    const [audit] = await h.sql`SELECT type,payload FROM pipeline_case_events
      WHERE case_id=${f.view.id} AND run_id=${admission.run.task.runId}`
    expect(audit).toMatchObject({
      type: 'updated',
      payload: { kind: 'hive.workflow.run_admitted' }
    })
  })
  it('admits exactly one run for competing request IDs without changing Case revision', async () => {
    const f = await fixture()
    const replies = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        runs.startWorkflowCase(f.accountId, { ...f.start, requestId: randomUUID() })
      )
    )
    expect(replies.filter((reply) => reply.status === 'fulfilled')).toHaveLength(1)
    expect(await counts(f)).toEqual({ runs: 1, issues: 5, personal: 0, revision: 1 })
  })
  it('keeps frozen execution input and four employee identities after a name/binding revision', async () => {
    const f = await fixture()
    const first = await runs.startWorkflowCase(f.accountId, f.start)
    const changed = await workbench.configureTeam(f.accountId, {
      requestId: randomUUID(),
      projectId: f.project.id,
      expectedRevision: 2,
      employees: f.employees.map((employee) => ({ ...employee, name: `${employee.role} renamed` }))
    })
    expect(changed.employees.map((employee) => employee.binding.employeeRef).toSorted()).toEqual(
      f.team.employees.map((employee) => employee.binding.employeeRef).toSorted()
    )
    expect(await runs.startWorkflowCase(f.accountId, f.start)).toEqual({ ...first, replayed: true })
  })
  it.each(['product', 'developer', 'tester', 'ops'])(
    'rejects a deleted current %s role for existing run scope',
    async (role) => {
      const f = await fixture()
      const admission = await runs.startWorkflowCase(f.accountId, f.start)
      await h.sql`DELETE FROM hive_workbench_employee_bindings WHERE project_id=${f.project.id} AND role=${role}`
      await expect(
        h.repository.read(f.accountId, f.task.taskId, admission.run.task.runId)
      ).rejects.toThrow('REVISION_CONFLICT')
      await expect(runs.startWorkflowCase(f.accountId, f.start)).rejects.toThrow(
        'REVISION_CONFLICT'
      )
    }
  )
  it('repairs only the exact original review metadata and preserves an already admitted native intent', async () => {
    const f = await fixture()
    const admission = await runs.startWorkflowCase(f.accountId, f.start)
    const [before] =
      await h.sql`SELECT version,updated_at FROM pipeline_cases WHERE id=${f.view.id}`
    const [intent] = await h.sql`SELECT workflow_input,input_fingerprint FROM hive_task_bindings
      WHERE run_id=${admission.run.task.runId}`
    await h.sql`UPDATE pipeline_stages SET config=jsonb_build_object('hiveWorkflow',config->'hiveWorkflow')
      WHERE pipeline_id=${f.workflow.workflowId} AND kind='review'`
    await workflows.getWorkflow(f.accountId, {
      projectId: f.project.id,
      workflowId: f.workflow.workflowId
    })
    const [review] =
      await h.sql`SELECT config FROM pipeline_stages WHERE pipeline_id=${f.workflow.workflowId} AND kind='review'`
    expect(review.config).toMatchObject({
      requireApproval: true,
      approver: {
        kind: 'agent',
        id: f.team.employees.find((employee) => employee.binding.role === 'tester').binding
          .employeeRef
      }
    })
    expect(
      (await h.sql`SELECT version,updated_at FROM pipeline_cases WHERE id=${f.view.id}`)[0]
    ).toEqual(before)
    expect(
      (
        await h.sql`SELECT workflow_input,input_fingerprint FROM hive_task_bindings
      WHERE run_id=${admission.run.task.runId}`
      )[0]
    ).toEqual(intent)
    await workflows.getWorkflow(f.accountId, {
      projectId: f.project.id,
      workflowId: f.workflow.workflowId
    })
    const audits =
      await h.sql`SELECT type,actor_type,actor_user_id,payload FROM pipeline_case_events
      WHERE case_id=${f.view.id} AND payload->>'kind'='hive.workflow.review_policy_repaired'`
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      type: 'updated',
      actor_type: 'user',
      actor_user_id: f.view.team.company.ownerActorRef
    })
    expect((await runs.startWorkflowCase(f.accountId, f.start)).replayed).toBe(true)
  })
  it.each(['customConfig', 'customEdge', 'replacedDeveloper'])(
    'refuses metadata repair after %s without rewriting the review',
    async (boundary) => {
      const f = await fixture()
      await h.sql`UPDATE pipeline_stages SET config=jsonb_build_object('hiveWorkflow',config->'hiveWorkflow')
      WHERE pipeline_id=${f.workflow.workflowId} AND kind='review'`
      if (boundary === 'customConfig') {
        await h.sql`UPDATE pipeline_stages SET config=config||'{"disabled":true}'::jsonb
        WHERE pipeline_id=${f.workflow.workflowId} AND kind='review'`
      }
      if (boundary === 'customEdge') {
        await h.sql`UPDATE pipeline_transitions SET label='custom'
        WHERE pipeline_id=${f.workflow.workflowId}`
      }
      if (boundary === 'replacedDeveloper') {
        const old = f.team.employees.find((employee) => employee.binding.role === 'developer')
          .binding.employeeRef
        const replacement = randomUUID()
        await h.sql`INSERT INTO agents(id,company_id,name,role,adapter_type,adapter_config)
        SELECT ${replacement},company_id,name,role,adapter_type,adapter_config FROM agents WHERE id=${old}`
        await h.sql`UPDATE hive_workbench_employee_bindings SET employee_id=${replacement}
        WHERE project_id=${f.project.id} AND role='developer'`
      }
      const [before] =
        await h.sql`SELECT config FROM pipeline_stages WHERE pipeline_id=${f.workflow.workflowId} AND kind='review'`
      await expect(
        workflows.getWorkflow(f.accountId, {
          projectId: f.project.id,
          workflowId: f.workflow.workflowId
        })
      ).rejects.toThrow('REVISION_CONFLICT')
      expect(
        (
          await h.sql`SELECT config FROM pipeline_stages WHERE pipeline_id=${f.workflow.workflowId} AND kind='review'`
        )[0]
      ).toEqual(before)
      expect(
        await h.sql`SELECT id FROM pipeline_case_events WHERE case_id=${f.view.id}
      AND payload->>'kind'='hive.workflow.review_policy_repaired'`
      ).toHaveLength(0)
    }
  )
  it('keeps unsupported graph data readable while refusing its automatic execution', async () => {
    const f = await fixture()
    const stages = structuredClone(f.definitionInput.stages)
    stages.find((stage) => stage.role === 'ops').dependsOn.push(stages[0].stageRef)
    const saved = await workflows.saveWorkflow(f.accountId, {
      ...f.definitionInput,
      requestId: randomUUID(),
      workflowId: f.workflow.workflowId,
      expectedRevision: 1,
      stages
    })
    expect(
      await workflows.getWorkflow(f.accountId, {
        projectId: f.project.id,
        workflowId: saved.workflowId
      })
    ).toEqual(saved)
    const created = await cases.createWorkflowCase(f.accountId, {
      ...f.input,
      requestId: randomUUID(),
      workflowRevision: saved.definition.workflowRevision,
      definitionDigest: saved.definitionDigest
    })
    const task = created.view.stageTasks.find(
      (stage) => stage.stageRef === created.view.currentStageRef
    )
    await expect(
      runs.startWorkflowCase(f.accountId, {
        requestId: randomUUID(),
        projectId: f.project.id,
        caseId: created.view.id,
        expectedCaseRevision: created.view.revision,
        stageRef: task.stageRef,
        expectedTaskRevision: task.taskRevision
      })
    ).rejects.toThrow('CAPABILITY_UNAVAILABLE')
    expect(
      await h.sql`SELECT id FROM heartbeat_runs WHERE company_id=${f.company.id}`
    ).toHaveLength(0)
  })
  it('retains unconfigured workflow data without fabricating a Tester approver', async () => {
    const f = await createWorkflowCasePostgresFixture({ workbench, workflows, cases }, false)
    expect(
      await workflows.getWorkflow(f.accountId, {
        projectId: f.project.id,
        workflowId: f.workflow.workflowId
      })
    ).toEqual(f.workflow)
    const [review] =
      await h.sql`SELECT config FROM pipeline_stages WHERE pipeline_id=${f.workflow.workflowId} AND kind='review'`
    expect(Object.keys(review.config)).toEqual(['hiveWorkflow'])
    expect(
      await h.sql`SELECT id FROM activity_log WHERE company_id=${f.company.id}
      AND action='hive.workflow.review_policy_repaired'`
    ).toHaveLength(0)
  })
  it('repairs via the direct pool scope reader and keeps an existing transaction repair inside its rollback', async () => {
    const f = await fixture()
    const admission = await runs.startWorkflowCase(f.accountId, f.start)
    const reader = createTaskRunScopeReader(h.sql)
    expect(typeof h.sql.begin).toBe('function')
    await h.sql.begin(async (db) => {
      expect(db.begin).toBeUndefined()
      expect(typeof db.savepoint).toBe('function')
    })
    await h.sql`UPDATE pipeline_stages SET config=jsonb_build_object('hiveWorkflow',config->'hiveWorkflow')
      WHERE pipeline_id=${f.workflow.workflowId} AND kind='review'`
    await expect(
      h.sql.begin(async (db) => {
        await reader.read(db, f.accountId, f.task.taskId, admission.run.task.runId)
        throw new Error('Original transaction rollback')
      })
    ).rejects.toThrow('Original transaction rollback')
    expect(
      (
        await h.sql`SELECT config FROM pipeline_stages WHERE pipeline_id=${f.workflow.workflowId} AND kind='review'`
      )[0].config.requireApproval
    ).toBeUndefined()
    expect(
      await h.sql`SELECT id FROM pipeline_case_events WHERE case_id=${f.view.id}
      AND payload->>'kind'='hive.workflow.review_policy_repaired'`
    ).toHaveLength(0)
    await reader.read(undefined, f.accountId, f.task.taskId, admission.run.task.runId)
    await reader.resolve(undefined, f.company.id, admission.run.task.runId, f.accountId)
    expect(
      await h.sql`SELECT id FROM pipeline_case_events WHERE case_id=${f.view.id}
      AND payload->>'kind'='hive.workflow.review_policy_repaired'`
    ).toHaveLength(1)
  })
})
