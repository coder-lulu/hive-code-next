import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { createWorkflowCasePostgresFixture } from './paperclip-workflow-cases-postgres-fixture.mjs'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { createWorkflowDefinitionRepository } from '../../integration/paperclip/service/workflow-definition-repository.mjs'
import { createWorkflowCaseRepository } from '../../integration/paperclip/service/workflow-case-repository.mjs'
import {
  handleTeamWorkbenchRequest,
  WORKBENCH_PATHS
} from '../../integration/paperclip/service/team-workbench-routes.mjs'
import { workflowTestVectors } from '../../src/shared/task-workflow/workflow.test-fixture.ts'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import {
  HiveWorkflowCaseCreateSchema,
  HiveWorkflowCaseCreateReplySchema
} from '../../src/shared/hive-workflow-cases.ts'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
function admittedReply(rawInput, rawReply, replayed) {
  const input = HiveWorkflowCaseCreateSchema.parse(rawInput)
  const reply = HiveWorkflowCaseCreateReplySchema.parse(rawReply)
  expect(reply.admission).toMatchObject({
    requestId: input.requestId,
    caseId: reply.view.id,
    payloadFingerprint: digest({ operation: 'cases.create', input })
  })
  if (replayed !== undefined) {
    expect(reply.admission.replayed).toBe(replayed)
  }
  expect(reply.view.binding).toMatchObject({
    scope: { projectRef: input.projectId },
    workflowRef: input.workflowId,
    workflowRevision: input.workflowRevision
  })
  expect(reply.view).toMatchObject({
    definitionDigest: input.definitionDigest,
    projectBindingRevision: input.expectedProjectRevision
  })
  if (!reply.admission.replayed) {
    expect(reply.view).toMatchObject({ title: input.title, requirement: input.requirement })
  }
  return reply
}
describe.skipIf(!configPath)('real requirement case admission in Paperclip PostgreSQL', () => {
  let h, workbench, workflows, cases
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
    for (const file of [
      'team-workbench-tables.sql',
      'workflow-definition-tables.sql',
      'workflow-case-tables.sql',
      'workflow-plan-intent-tables.sql'
    ]) {
      await h.sql.unsafe(
        await readFile(
          new URL(`../../integration/paperclip/service/${file}`, import.meta.url),
          'utf8'
        )
      )
    }
    workbench = createTeamWorkbenchRepository(h.sql)
    workflows = createWorkflowDefinitionRepository(h.sql)
    cases = createWorkflowCaseRepository(h.sql)
  })
  afterAll(async () => h?.sql.end({ timeout: 5 }))
  async function admit(accountId, input, replayed = false) {
    return admittedReply(input, await cases.createWorkflowCase(accountId, input), replayed).view
  }
  const fixture = (configure, stages) =>
    createWorkflowCasePostgresFixture({ workbench, workflows, cases }, configure, stages)
  async function counts(f) {
    const [row] = await h.sql`SELECT issue_counter,
      (SELECT count(*)::integer FROM issues WHERE company_id=${f.company.id}) AS issues,
      (SELECT count(*)::integer FROM pipeline_cases WHERE company_id=${f.company.id}) AS cases,
      (SELECT count(*)::integer FROM pipeline_case_events WHERE company_id=${f.company.id}) AS events,
      (SELECT count(*)::integer FROM pipeline_case_issue_links WHERE company_id=${f.company.id}) AS links,
      (SELECT count(*)::integer FROM hive_workflow_case_bindings WHERE company_id=${f.company.id}) AS bindings,
      (SELECT count(*)::integer FROM hive_workflow_case_stage_issues r JOIN hive_workflow_case_bindings b ON b.case_id=r.case_id
        WHERE b.company_id=${f.company.id}) AS stages,
      (SELECT count(*)::integer FROM activity_log WHERE company_id=${f.company.id} AND action='hive.workflow.case_created') AS audit,
      (SELECT count(*)::integer FROM hive_workbench_request_receipts WHERE company_id=${f.company.id} AND operation='cases.create') AS receipts,
      (SELECT count(*)::integer FROM heartbeat_runs WHERE company_id=${f.company.id}) AS heartbeats,
      (SELECT count(*)::integer FROM pipeline_automation_executions WHERE company_id=${f.company.id}) AS automation
      FROM companies WHERE id=${f.company.id}`
    return row
  }

  it('acknowledges a normalized first admission and replay against one immutable receipt', async () => {
    const f = await fixture()
    const raw = {
      ...f.input,
      requestId: f.input.requestId.toUpperCase(),
      projectId: f.input.projectId.toUpperCase(),
      workflowId: f.input.workflowId.toUpperCase(),
      title: '  Normalized requirement admission  '
    }
    const input = HiveWorkflowCaseCreateSchema.parse(raw)
    const first = admittedReply(raw, await cases.createWorkflowCase(f.accountId, raw), false)
    expect(first.admission).toEqual({
      requestId: input.requestId,
      caseId: first.view.id,
      payloadFingerprint: digest({ operation: 'cases.create', input }),
      replayed: false
    })
    expect(first.admission.payloadFingerprint).not.toBe(
      digest({ operation: 'cases.create', input: raw })
    )
    const [receipt] = await h.sql`SELECT operation,payload_fingerprint,response_json
      FROM hive_workbench_request_receipts WHERE account_id=${f.accountId} AND request_id=${input.requestId}`
    expect(receipt.operation).toBe('cases.create')
    expect(receipt.payload_fingerprint).toBe(first.admission.payloadFingerprint)
    expect(receipt.response_json).toEqual(first.view)
    const replay = admittedReply(input, await cases.createWorkflowCase(f.accountId, input), true)
    expect(replay.admission).toEqual({ ...first.admission, replayed: true })
    expect(replay.view).toEqual(first.view)
    expect((await counts(f)).receipts).toBe(1)
    expect((await counts(f)).cases).toBe(1)
  })

  it('persists the real case, origin and per-stage work Issues with one audit and no execution', async () => {
    const f = await fixture()
    const view = await admit(f.accountId, f.input)
    expect(await f.read(view.id)).toEqual(view)
    expect(view.executionAvailability).toEqual({
      available: false,
      reason: 'EXECUTION_ISOLATION_UNAVAILABLE'
    })
    expect(await counts(f)).toEqual({
      issue_counter: 5,
      issues: 5,
      cases: 1,
      events: 1,
      links: 5,
      bindings: 1,
      stages: 4,
      audit: 1,
      receipts: 1,
      heartbeats: 0,
      automation: 0
    })
    const [business] = await h.sql`SELECT * FROM pipeline_cases WHERE id=${view.id}`
    expect(business).toMatchObject({
      company_id: f.company.id,
      pipeline_id: f.workflow.workflowId,
      title: f.input.title,
      version: 1,
      terminal_kind: null,
      lease_token: null,
      workspace_ref: null
    })
    const issues =
      await h.sql`SELECT * FROM issues WHERE company_id=${f.company.id} ORDER BY issue_number`
    expect(issues[0]).toMatchObject({
      id: view.originTaskId,
      project_id: f.project.id,
      title: f.input.title,
      description: f.input.requirement,
      parent_id: null,
      assignee_agent_id: null
    })
    expect(
      issues.every(
        (issue) =>
          issue.status === 'backlog' &&
          issue.execution_run_id === null &&
          issue.checkout_run_id === null &&
          issue.responsible_user_id === view.team.company.ownerActorRef
      )
    ).toBe(true)
    expect(new Set(issues.map((issue) => issue.identifier)).size).toBe(5)
    for (const task of view.stageTasks) {
      expect(issues.find((issue) => issue.id === task.taskId)).toMatchObject({
        company_id: f.company.id,
        project_id: f.project.id,
        parent_id: view.originTaskId,
        assignee_agent_id: task.employeeRef,
        assignee_user_id: null,
        status: 'backlog'
      })
    }
    const [event] = await h.sql`SELECT * FROM pipeline_case_events WHERE case_id=${view.id}`
    expect(event).toMatchObject({
      type: 'ingested',
      actor_type: 'user',
      actor_user_id: view.team.company.ownerActorRef,
      actor_agent_id: null,
      run_id: null,
      to_stage_id: business.stage_id
    })
    expect(
      await h.sql`SELECT * FROM hive_task_accounts WHERE account_id=${f.accountId}`
    ).toHaveLength(0)
  })

  it('serializes concurrent identical requests and recovers a lost response without duplicate business rows', async () => {
    const f = await fixture()
    const replies = await Promise.all(
      Array.from({ length: 6 }, () => cases.createWorkflowCase(f.accountId, f.input))
    )
    const views = replies.map((reply) => admittedReply(f.input, reply).view)
    expect(replies.filter((reply) => !reply.admission.replayed)).toHaveLength(1)
    expect(replies.filter((reply) => reply.admission.replayed)).toHaveLength(5)
    expect(views.every((view) => digest(view) === digest(views[0]))).toBe(true)
    expect((await counts(f)).receipts).toBe(1)
    expect((await counts(f)).issues).toBe(5)
    await expect(
      admit(f.accountId, { ...f.input, requirement: 'Changed request' })
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    await expect(
      workbench.createCompany(f.accountId, {
        requestId: f.input.requestId,
        name: 'Another operation'
      })
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(await admit(f.accountId, f.input, true)).toEqual(views[0])
  })

  it('replays before current team/revision checks and returns the fixed admission binding with current business facts', async () => {
    const f = await fixture()
    const first = await admit(f.accountId, f.input)
    await workbench.configureTeam(f.accountId, {
      requestId: randomUUID(),
      projectId: f.project.id,
      expectedRevision: 2,
      employees: f.employees.map((employee) => ({ ...employee, name: `Updated ${employee.role}` }))
    })
    await h.sql`UPDATE issues SET status='in_review',status_version=status_version+1 WHERE id=${first.stageTasks[1].taskId}`
    await h.sql`UPDATE pipeline_cases SET title='Updated business title',version=version+1,updated_at=now() WHERE id=${first.id}`
    await h.sql`UPDATE issues SET description='Updated business requirement' WHERE id=${first.originTaskId}`
    const recovered = await admit(f.accountId, f.input, true)
    expect(recovered.team).toEqual(first.team)
    expect(recovered.workflow).toEqual(first.workflow)
    expect(recovered.projectBindingRevision).toBe(2)
    expect(recovered.title).toBe('Updated business title')
    expect(recovered.requirement).toBe('Updated business requirement')
    expect(recovered.revision).toBe(2)
    expect(recovered.stageTasks[1]).toMatchObject({ status: 'in_review', taskRevision: 1 })
    const before = await counts(f)
    await expect(admit(f.accountId, { ...f.input, requestId: randomUUID() })).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    expect(await counts(f)).toEqual(before)
    const next = await admit(f.accountId, {
      ...f.input,
      requestId: randomUUID(),
      expectedProjectRevision: 3
    })
    expect(next.projectBindingRevision).toBe(3)
    expect(next.workflow.definition).toEqual(first.workflow.definition)
    expect((await f.read(first.id)).team).toEqual(first.team)
    const reply = admittedReply(f.input, await cases.createWorkflowCase(f.accountId, f.input), true)
    expect(reply.admission).toEqual({
      requestId: f.input.requestId,
      caseId: first.id,
      payloadFingerprint: digest({
        operation: 'cases.create',
        input: HiveWorkflowCaseCreateSchema.parse(f.input)
      }),
      replayed: true
    })
    expect(reply.view).toEqual(recovered)
  })

  it('requires four current employees, matching project revision, digest and an existing exact definition revision', async () => {
    const empty = await fixture(false)
    const before = await counts(empty)
    await expect(admit(empty.accountId, empty.input)).rejects.toThrow('REVISION_CONFLICT')
    expect(await counts(empty)).toEqual(before)
    const f = await fixture()
    for (const changed of [
      { expectedProjectRevision: 1 },
      { definitionDigest: 'f'.repeat(64) },
      { workflowRevision: 999 }
    ]) {
      const original = await counts(f)
      await expect(admit(f.accountId, { ...f.input, ...changed })).rejects.toThrow(
        changed.workflowRevision ? 'FORBIDDEN' : 'REVISION_CONFLICT'
      )
      expect(await counts(f)).toEqual(original)
    }
    await h.sql`UPDATE agents SET adapter_config='{"unreviewed":true}'::jsonb WHERE id=${f.team.employees[0].binding.employeeRef}`
    await expect(admit(f.accountId, f.input)).rejects.toThrow('REVISION_CONFLICT')
    expect((await counts(f)).cases).toBe(0)
  })

  it('refuses foreign accounts and projects for create, list, read and replay without partial writes', async () => {
    const f = await fixture(),
      foreign = await fixture()
    const view = await admit(f.accountId, f.input)
    const before = await counts(f),
      foreignBefore = await counts(foreign)
    await expect(admit(foreign.accountId, f.input)).rejects.toThrow('FORBIDDEN')
    await expect(
      cases.listWorkflowCases(foreign.accountId, { projectId: f.project.id })
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      cases.getWorkflowCase(foreign.accountId, { projectId: f.project.id, caseId: view.id })
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      cases.getWorkflowCase(f.accountId, { projectId: foreign.project.id, caseId: view.id })
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      admit(foreign.accountId, {
        ...foreign.input,
        workflowId: f.workflow.workflowId,
        definitionDigest: f.workflow.definitionDigest
      })
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      cases.listWorkflowCases(foreign.accountId, {
        projectId: foreign.project.id,
        workflowId: f.workflow.workflowId
      })
    ).rejects.toThrow('FORBIDDEN')
    expect(await counts(f)).toEqual(before)
    expect(await counts(foreign)).toEqual(foreignBefore)
  })

  it('pins historical definitions and explicitly selects the product root regardless of array position', async () => {
    const f = await fixture(true, workflowTestVectors.examples.definition.stages.toReversed())
    const first = await admit(f.accountId, f.input)
    expect(first.currentStageRef).toBe(
      f.workflow.definition.stages.find((stage) => stage.role === 'product').stageRef
    )
    const [entry] =
      await h.sql`SELECT s.kind,s.config FROM pipeline_cases c JOIN pipeline_stages s ON s.id=c.stage_id WHERE c.id=${first.id}`
    expect(entry).toMatchObject({
      kind: 'working',
      config: { hiveWorkflow: { stage: { role: 'product', dependsOn: [] } } }
    })
    const second = await workflows.saveWorkflow(f.accountId, {
      ...f.definitionInput,
      requestId: randomUUID(),
      workflowId: f.workflow.workflowId,
      expectedRevision: 1,
      name: 'New definition'
    })
    const historical = await admit(f.accountId, {
      ...f.input,
      requestId: randomUUID()
    })
    expect(historical.workflow).toEqual(first.workflow)
    expect((await f.read(first.id)).workflow).toEqual(first.workflow)
    const latest = await admit(f.accountId, {
      ...f.input,
      requestId: randomUUID(),
      workflowRevision: 2,
      definitionDigest: second.definitionDigest
    })
    const [row] = await h.sql`SELECT c.pipeline_id,r.pipeline_id AS expected FROM pipeline_cases c
      JOIN hive_workflow_definition_revisions r ON r.workflow_id=${f.workflow.workflowId} AND r.revision=2 WHERE c.id=${latest.id}`
    expect(row.pipeline_id).toBe(row.expected)
    expect(row.pipeline_id).not.toBe(first.workflow.workflowId)
  })

  it('keeps cases and workflow references scoped across projects owned by the same account', async () => {
    const f = await fixture(),
      view = await admit(f.accountId, f.input)
    const other = await workbench.createProject(f.accountId, {
      requestId: randomUUID(),
      companyId: f.company.id,
      name: 'Other owned project',
      workspaceSelector: 'folder:other-case-fixture',
      hiveWorkspaceRef: `workspace:${randomUUID()}`
    })
    await workbench.configureTeam(f.accountId, {
      requestId: randomUUID(),
      projectId: other.id,
      expectedRevision: 1,
      employees: f.employees
    })
    const before = await counts(f)
    await expect(
      cases.getWorkflowCase(f.accountId, { projectId: other.id, caseId: view.id })
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      cases.listWorkflowCases(f.accountId, {
        projectId: other.id,
        workflowId: f.workflow.workflowId
      })
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      admit(f.accountId, {
        ...f.input,
        requestId: randomUUID(),
        projectId: other.id
      })
    ).rejects.toThrow('FORBIDDEN')
    expect(await cases.listWorkflowCases(f.accountId, { projectId: other.id })).toEqual({
      items: [],
      nextCursor: null
    })
    expect(await counts(f)).toEqual(before)
  })

  it('revalidates current project permission before returning an existing receipt', async () => {
    const f = await fixture(),
      view = await admit(f.accountId, f.input)
    await h.sql`UPDATE hive_workbench_company_bindings SET account_id=${`revoked:${randomUUID()}`} WHERE company_id=${f.company.id}`
    const before = await counts(f)
    await expect(admit(f.accountId, f.input)).rejects.toThrow('FORBIDDEN')
    await expect(f.read(view.id)).rejects.toThrow('FORBIDDEN')
    await expect(cases.listWorkflowCases(f.accountId, { projectId: f.project.id })).rejects.toThrow(
      'FORBIDDEN'
    )
    expect(await counts(f)).toEqual(before)
  })

  it('rejects a receipt redirected to another real case with the same admission payload', async () => {
    const f = await fixture(),
      first = await admit(f.accountId, f.input)
    const other = await admit(f.accountId, {
      ...f.input,
      requestId: randomUUID()
    })
    await h.sql`UPDATE hive_workbench_request_receipts SET response_json=${h.sql.json(other)}
      WHERE account_id=${f.accountId} AND request_id=${f.input.requestId}`
    const before = await counts(f)
    await expect(admit(f.accountId, f.input)).rejects.toThrow('REVISION_CONFLICT')
    expect(await counts(f)).toEqual(before)
    expect(await f.read(first.id)).toEqual(first)
  })

  it.each(['pipeline', 'stage', 'transition'])(
    'refuses %s graph drift for admission, read, list and replay',
    async (kind) => {
      const f = await fixture()
      const first = await admit(f.accountId, f.input)
      if (kind === 'pipeline') {
        await h.sql`UPDATE pipelines SET name='Unbound graph' WHERE id=${f.workflow.workflowId}`
      }
      if (kind === 'stage') {
        await h.sql`UPDATE pipeline_stages SET config='{}'::jsonb WHERE pipeline_id=${f.workflow.workflowId} AND kind='review'`
      }
      if (kind === 'transition') {
        await h.sql`DELETE FROM pipeline_transitions WHERE pipeline_id=${f.workflow.workflowId}`
      }
      const before = await counts(f)
      await expect(f.read(first.id)).rejects.toThrow('REVISION_CONFLICT')
      await expect(
        cases.listWorkflowCases(f.accountId, { projectId: f.project.id })
      ).rejects.toThrow('REVISION_CONFLICT')
      await expect(admit(f.accountId, f.input)).rejects.toThrow('REVISION_CONFLICT')
      await expect(admit(f.accountId, { ...f.input, requestId: randomUUID() })).rejects.toThrow(
        'REVISION_CONFLICT'
      )
      expect(await counts(f)).toEqual(before)
    }
  )

  it('reads real Issue state and rejects an assignee/link scope drift instead of trusting the stage mapping', async () => {
    const f = await fixture(),
      foreign = await fixture()
    const view = await admit(f.accountId, f.input)
    await h.sql`UPDATE issues SET status='blocked',status_version=41 WHERE id=${view.stageTasks[0].taskId}`
    expect((await f.read(view.id)).stageTasks[0]).toMatchObject({
      status: 'blocked',
      taskRevision: 1
    })
    await h.sql`UPDATE issues SET assignee_agent_id=${foreign.team.employees[0].binding.employeeRef} WHERE id=${view.stageTasks[0].taskId}`
    await expect(f.read(view.id)).rejects.toThrow('REVISION_CONFLICT')
  })

  it('makes binding and stage references immutable while upstream content remains authoritative', async () => {
    const f = await fixture(),
      view = await admit(f.accountId, f.input)
    await expect(
      h.sql`UPDATE hive_workflow_case_bindings SET project_binding_revision=3 WHERE case_id=${view.id}`
    ).rejects.toThrow('immutable')
    await expect(
      h.sql`DELETE FROM hive_workflow_case_stage_issues WHERE case_id=${view.id}`
    ).rejects.toThrow('immutable')
    await h.sql`UPDATE issues SET description='Revised real requirement' WHERE id=${view.originTaskId}`
    expect((await f.read(view.id)).requirement).toBe('Revised real requirement')
    const columns =
      await h.sql`SELECT column_name FROM information_schema.columns WHERE table_name='hive_workflow_case_bindings'`
    expect(
      columns.some(({ column_name }) =>
        ['title', 'requirement', 'status', 'version'].includes(column_name)
      )
    ).toBe(false)
  })

  it.each(['company', 'project', 'revision', 'digest', 'title', 'requirement', 'projectRevision'])(
    'rejects a tampered create receipt %s before recovery',
    async (field) => {
      const f = await fixture(),
        first = await admit(f.accountId, f.input)
      const changed = structuredClone(first)
      if (field === 'title') {
        changed.title = 'Tampered title'
      }
      if (field === 'requirement') {
        changed.requirement = 'Tampered requirement'
      }
      if (field === 'revision') {
        changed.binding.workflowRevision += 1
        changed.workflow.definition.workflowRevision += 1
      }
      if (field === 'digest') {
        changed.workflow.name = 'Tampered definition'
      }
      if (field === 'company' || field === 'project') {
        const member = field === 'company' ? 'companyRef' : 'projectRef',
          id = randomUUID()
        changed.binding.scope[member] = id
        changed.workflow.definition.scope[member] = id
        changed.team.project.scope[member] = id
        changed.team.employees.forEach((employee) => {
          employee.scope[member] = id
        })
        if (field === 'company') {
          changed.team.company.companyRef = id
        }
      }
      if (field === 'projectRevision') {
        changed.projectBindingRevision += 1
        changed.team.project.bindingRevision += 1
        changed.workflow.projectBindingRevision += 1
        changed.team.employees.forEach((employee) => {
          employee.bindingRevision += 1
        })
      }
      changed.definitionDigest = changed.workflow.definitionDigest = digest({
        name: changed.workflow.name,
        definition: changed.workflow.definition
      })
      await h.sql`UPDATE hive_workbench_request_receipts SET response_json=${h.sql.json(changed)}
        WHERE account_id=${f.accountId} AND request_id=${f.input.requestId}`
      const before = await counts(f)
      await expect(admit(f.accountId, f.input)).rejects.toThrow('REVISION_CONFLICT')
      expect(await counts(f)).toEqual(before)
      expect(await f.read(first.id)).toEqual(first)
    }
  )

  it('rolls back every actual business row, Issue number and receipt when the transaction fails after all writes', async () => {
    const f = await fixture(),
      before = await counts(f)
    const failing = createWorkflowCaseRepository({
      begin: (run) =>
        h.sql.begin(async (db) => {
          const view = await run(db)
          const [inside] =
            await db`SELECT count(*)::integer AS count FROM issues WHERE company_id=${f.company.id}`
          expect(inside.count).toBe(5)
          expect(admittedReply(f.input, view, false).view.originTaskId).toBeTruthy()
          throw new Error('Synthetic admission transaction failure')
        })
    })
    await expect(failing.createWorkflowCase(f.accountId, f.input)).rejects.toThrow(
      'Synthetic admission transaction failure'
    )
    expect(await counts(f)).toEqual(before)
    const recovered = await admit(f.accountId, f.input)
    expect((await f.read(recovered.id)).originTaskId).toBe(recovered.originTaskId)
  })

  it('returns bounded UUID keyset summaries without case bodies or execution routes', async () => {
    const f = await fixture()
    const created = await Promise.all(
      Array.from({ length: 52 }, (_, index) =>
        admit(f.accountId, {
          ...f.input,
          requestId: randomUUID(),
          title: `Requirement ${index}`
        })
      )
    )
    const first = await cases.listWorkflowCases(f.accountId, {
      projectId: f.project.id,
      workflowId: f.workflow.workflowId,
      limit: 50
    })
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).toBe(first.items.at(-1).id)
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(384 * 1024)
    expect(
      first.items.some((item) =>
        ['requirement', 'workflow', 'team', 'stageTasks'].some((key) => key in item)
      )
    ).toBe(false)
    const second = await cases.listWorkflowCases(f.accountId, {
      projectId: f.project.id,
      after: first.nextCursor,
      limit: 50
    })
    expect(second.items).toHaveLength(2)
    expect(second.nextCursor).toBeNull()
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(
      created.map((item) => item.id).toSorted()
    )
    await expect(
      cases.listWorkflowCases(f.accountId, { projectId: f.project.id, limit: 51 })
    ).rejects.toThrow()
    expect(WORKBENCH_PATHS.filter((path) => path.includes('/cases/'))).toEqual([
      '/hive/workbench/cases/create',
      '/hive/workbench/cases/list',
      '/hive/workbench/cases/read',
      '/hive/workbench/cases/start',
      '/hive/workbench/cases/runs',
      '/hive/workbench/cases/run-read'
    ])
    expect(() =>
      handleTeamWorkbenchRequest(cases, f.accountId, '/hive/workbench/cases/run', {})
    ).toThrow('FORBIDDEN')
  })
})
