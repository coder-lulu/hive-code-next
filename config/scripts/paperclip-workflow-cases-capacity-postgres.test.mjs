import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { createWorkflowDefinitionRepository } from '../../integration/paperclip/service/workflow-definition-repository.mjs'
import { createWorkflowCaseRepository } from '../../integration/paperclip/service/workflow-case-repository.mjs'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { HiveWorkflowSnapshotSchema } from '../../src/shared/hive-task-workflows.ts'
import {
  HiveWorkflowCaseCreateSchema,
  HiveWorkflowCaseCreateReplySchema,
  HiveWorkflowCaseViewSchema
} from '../../src/shared/hive-workflow-cases.ts'
import { WORKFLOW_STAGE_LIMITS } from '../../src/shared/task-workflow/workflow-definition.ts'
import { createLocalTaskRequest } from '../../src/main/tasks/local-task-http-client.ts'
import { assertJsonTextStructureWithinLimits } from '../../src/shared/json-text-structure-limit.ts'
import {
  HIVE_WORKFLOW_CASE_RESPONSE_BYTES,
  HIVE_WORKFLOW_CASE_RESPONSE_BYTES_BY_PATH,
  HIVE_WORKFLOW_CASE_RESPONSE_TOKENS_BY_PATH
} from '../../src/shared/hive-workflow-case-response-budget.ts'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
const workflowBytes = 64 * 1024
const clientBytes = HIVE_WORKFLOW_CASE_RESPONSE_BYTES
const definitionStorageBytes = 98_304
const teamStorageBytes = 24_576
const evidenceDirectory = resolve('logs/paperclip-development/p3/replay-ack-backend')
const evidencePath = resolve(evidenceDirectory, 'capacity-measurements.json')
const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')

function admittedReply(rawInput, rawReply, replayed) {
  const input = HiveWorkflowCaseCreateSchema.parse(rawInput)
  const reply = HiveWorkflowCaseCreateReplySchema.parse(rawReply)
  expect(reply.admission).toEqual({
    requestId: input.requestId,
    caseId: reply.view.id,
    payloadFingerprint: digest({ operation: 'cases.create', input }),
    replayed
  })
  expect(reply.view.binding).toMatchObject({
    scope: { projectRef: input.projectId },
    workflowRef: input.workflowId,
    workflowRevision: input.workflowRevision
  })
  expect(reply.view).toMatchObject({
    definitionDigest: input.definitionDigest,
    projectBindingRevision: input.expectedProjectRevision
  })
  if (!replayed) {
    expect(reply.view).toMatchObject({ title: input.title, requirement: input.requirement })
  }
  return reply
}

function capacityStages(dense) {
  const roles = ['product', 'developer', 'tester', 'ops']
  const refs = Array.from({ length: WORKFLOW_STAGE_LIMITS.stages }, (_, index) =>
    dense ? `stage:${index}` : `stage:${index}`.padEnd(160, 's')
  )
  return refs.map((stageRef, index) => ({
    stageRef,
    role: roles[index % roles.length],
    outputKind: ['requirements', 'code', 'test_report', 'release_plan'][index % roles.length],
    dependsOn: dense ? refs.slice(0, index) : index ? [refs[index - 1]] : [],
    acceptanceCriteria: Array(WORKFLOW_STAGE_LIMITS.acceptanceCriteria).fill('a'),
    ...((dense && index) || index % roles.length === 2
      ? { returnToStageRef: refs[index - 1] }
      : {}),
    maxAttempts: 3
  }))
}

function capacityWorkflow(project, targetBytes, dense = false) {
  const input = {
    requestId: randomUUID(),
    projectId: project.id,
    expectedRevision: 0,
    expectedProjectRevision: project.binding.bindingRevision,
    name: '\u0001'.repeat(160),
    stages: capacityStages(dense),
    maxParallelism: 4,
    maxDurationMs: 86_400_000
  }
  const workflowId = randomUUID()
  const snapshot = () => {
    const definition = {
      contractVersion: 1,
      kind: 'workflow.definition',
      scope: project.binding.scope,
      workflowRef: workflowId,
      workflowRevision: 1,
      stages: input.stages,
      maxParallelism: input.maxParallelism,
      maxDurationMs: input.maxDurationMs
    }
    return {
      workflowId,
      name: input.name,
      definition,
      definitionDigest: digest({ name: input.name, definition }),
      projectBindingRevision: project.binding.bindingRevision
    }
  }
  let remaining = targetBytes - byteLength(snapshot())
  expect(remaining).toBeGreaterThan(0)
  for (const stage of input.stages) {
    for (let index = 0; index < stage.acceptanceCriteria.length && remaining; index++) {
      const escaped = Math.min(2047, Math.floor(remaining / 6))
      stage.acceptanceCriteria[index] += '\u0001'.repeat(escaped)
      remaining -= escaped * 6
      if (remaining < 6 && stage.acceptanceCriteria[index].length + remaining <= 2048) {
        stage.acceptanceCriteria[index] += 'x'.repeat(remaining)
        remaining = 0
      }
    }
  }
  expect(remaining).toBe(0)
  const parsed = HiveWorkflowSnapshotSchema.parse(snapshot())
  expect(byteLength(parsed)).toBe(targetBytes)
  return input
}

function minimumJsonBudget(content, resource, maximum) {
  let minimum = 0
  while (minimum < maximum) {
    const middle = Math.floor((minimum + maximum) / 2)
    try {
      assertJsonTextStructureWithinLimits(content, {
        nestingDepth: 16,
        structuralTokens: 16_384,
        [resource]: middle
      })
      maximum = middle
    } catch (error) {
      if (error.resource !== resource) {
        throw error
      }
      minimum = middle + 1
    }
  }
  return minimum
}

function persistedViewUpperBound(view) {
  const metadata = byteLength({
    ...view,
    title: '',
    requirement: '',
    workflow: null,
    team: null,
    stageTasks: [],
    binding: { ...view.binding, workflowRevision: Number.MAX_SAFE_INTEGER },
    projectBindingRevision: Number.MAX_SAFE_INTEGER,
    revision: 2_147_483_647,
    currentStageRef: 's'.repeat(160)
  })
  const stage = byteLength({
    stageRef: 's'.repeat(160),
    taskId: randomUUID(),
    employeeRef: randomUUID(),
    role: 'developer',
    taskRevision: Number.MAX_SAFE_INTEGER,
    status: 'in_progress'
  })
  // Stored JSONB includes whitespace; replacing its revision adds at most 15 decimal digits.
  return (
    metadata -
    10 +
    240 * 6 +
    48_000 * 6 +
    definitionStorageBytes +
    15 +
    teamStorageBytes +
    2 +
    WORKFLOW_STAGE_LIMITS.stages * stage +
    WORKFLOW_STAGE_LIMITS.stages -
    1
  )
}

describe.skipIf(!configPath)('real requirement case capacity in Paperclip PostgreSQL', () => {
  let h, workbench, workflows, cases
  const measurements = []
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
    const constraints = await h.sql`SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE contype='c' AND conrelid IN
        ('hive_workflow_definition_revisions'::regclass,'hive_workflow_case_bindings'::regclass)`
    expect(
      constraints.some(
        ({ definition }) =>
          definition.includes('definition_json') &&
          definition.includes(`<= ${definitionStorageBytes}`)
      )
    ).toBe(true)
    expect(
      constraints.some(
        ({ definition }) =>
          definition.includes('team_snapshot_json') && definition.includes(`<= ${teamStorageBytes}`)
      )
    ).toBe(true)
    workbench = createTeamWorkbenchRepository(h.sql)
    workflows = createWorkflowDefinitionRepository(h.sql)
    cases = createWorkflowCaseRepository(h.sql)
  })
  afterAll(async () => {
    await h?.sql.end({ timeout: 5 })
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(evidencePath, JSON.stringify(measurements, null, 2))
  })

  async function fixture() {
    const accountId = `case-capacity-postgres:${randomUUID()}`
    const company = await workbench.createCompany(accountId, {
      requestId: randomUUID(),
      name: 'Case capacity fixture'
    })
    const project = await workbench.createProject(accountId, {
      requestId: randomUUID(),
      companyId: company.id,
      name: 'Capacity project',
      workspaceSelector: 'folder:case-capacity',
      hiveWorkspaceRef: 'workspace:'.padEnd(160, 'w')
    })
    const team = await workbench.configureTeam(accountId, {
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
    return { accountId, company, project: team.project, team }
  }

  async function counts(f) {
    const [row] = await h.sql`SELECT issue_counter,
      (SELECT count(*)::integer FROM issues WHERE company_id=${f.company.id}) AS issues,
      (SELECT count(*)::integer FROM pipeline_cases WHERE company_id=${f.company.id}) AS cases,
      (SELECT count(*)::integer FROM pipeline_case_events WHERE company_id=${f.company.id}) AS events,
      (SELECT count(*)::integer FROM pipeline_case_issue_links WHERE company_id=${f.company.id}) AS links,
      (SELECT count(*)::integer FROM hive_workflow_case_bindings WHERE company_id=${f.company.id}) AS bindings,
      (SELECT count(*)::integer FROM hive_workflow_case_stage_issues r JOIN hive_workflow_case_bindings b ON b.case_id=r.case_id WHERE b.company_id=${f.company.id}) AS stage_issues,
      (SELECT count(*)::integer FROM pipelines WHERE company_id=${f.company.id}) AS pipelines,
      (SELECT count(*)::integer FROM pipeline_stages s JOIN pipelines p ON p.id=s.pipeline_id WHERE p.company_id=${f.company.id}) AS pipeline_stages,
      (SELECT count(*)::integer FROM pipeline_transitions t JOIN pipelines p ON p.id=t.pipeline_id WHERE p.company_id=${f.company.id}) AS transitions,
      (SELECT count(*)::integer FROM hive_workflow_definitions WHERE company_id=${f.company.id}) AS definitions,
      (SELECT count(*)::integer FROM hive_workflow_definition_revisions WHERE company_id=${f.company.id}) AS revisions,
      (SELECT count(*)::integer FROM hive_workbench_request_receipts WHERE company_id=${f.company.id}) AS receipts,
      (SELECT count(*)::integer FROM activity_log WHERE company_id=${f.company.id}) AS audit,
      (SELECT count(*)::integer FROM heartbeat_runs WHERE company_id=${f.company.id}) AS heartbeats,
      (SELECT count(*)::integer FROM pipeline_automation_executions WHERE company_id=${f.company.id}) AS automation
      FROM companies WHERE id=${f.company.id}`
    return row
  }

  it.each([
    ['JSON escaping', '\u0001', false],
    ['three-byte Unicode', '界', false],
    ['supplementary Unicode', '😀', false],
    ['dense DAG', '\u0001', true]
  ])(
    'round-trips a maximum saved workflow and maximum %s case text within the actual client cap',
    async (label, character, dense) => {
      const f = await fixture()
      const workflow = await workflows.saveWorkflow(
        f.accountId,
        capacityWorkflow(f.project, workflowBytes, dense)
      )
      expect(byteLength(workflow)).toBe(workflowBytes)
      const input = {
        requestId: randomUUID(),
        projectId: f.project.id,
        workflowId: workflow.workflowId,
        workflowRevision: 1,
        definitionDigest: workflow.definitionDigest,
        expectedProjectRevision: 2,
        title: character.repeat(240 / character.length),
        requirement: character.repeat(48_000 / character.length)
      }
      const reply = admittedReply(input, await cases.createWorkflowCase(f.accountId, input), false)
      const view = reply.view
      const response = JSON.stringify(reply)
      const size = Buffer.byteLength(response, 'utf8')
      expect(view.stageTasks).toHaveLength(WORKFLOW_STAGE_LIMITS.stages)
      expect(view.requirement).toBe(input.requirement)
      expect(view.title).toBe(input.title)
      expect(
        await cases.getWorkflowCase(f.accountId, { projectId: f.project.id, caseId: view.id })
      ).toEqual(view)
      const replay = admittedReply(input, await cases.createWorkflowCase(f.accountId, input), true)
      expect(replay.view).toEqual(view)
      expect(replay.admission).toEqual({ ...reply.admission, replayed: true })
      expect(size).toBeLessThan(clientBytes)
      const acknowledgementBytes = byteLength({ admission: reply.admission, view: null }) - 4
      const upperBound = persistedViewUpperBound(view) + acknowledgementBytes
      expect(size).toBeLessThanOrEqual(upperBound)
      expect(upperBound).toBeLessThan(clientBytes)
      const structuralTokens = minimumJsonBudget(response, 'structuralTokens', 16_384)
      const nestingDepth = minimumJsonBudget(response, 'nestingDepth', 16)
      const request = createLocalTaskRequest({
        baseUrl: 'http://127.0.0.1:63555/',
        secret: 'a'.repeat(43),
        maximumResponseBytes: 512 * 1024,
        maximumResponseBytesByPath: HIVE_WORKFLOW_CASE_RESPONSE_BYTES_BY_PATH,
        maximumResponseStructuralTokensByPath: HIVE_WORKFLOW_CASE_RESPONSE_TOKENS_BY_PATH,
        fetch: async (url) =>
          new Response(
            new URL(url).pathname.endsWith('/create') ? response : JSON.stringify(view),
            { status: 200 }
          )
      })
      expect(
        HiveWorkflowCaseCreateReplySchema.parse(
          await request('/hive/workbench/cases/create', input)
        )
      ).toEqual(reply)
      expect(
        HiveWorkflowCaseViewSchema.parse(
          await request('/hive/workbench/cases/read', { projectId: f.project.id, caseId: view.id })
        )
      ).toEqual(view)
      expect(await counts(f)).toMatchObject({
        issue_counter: 33,
        issues: 33,
        cases: 1,
        events: 1,
        links: 33,
        bindings: 1,
        stage_issues: 32,
        receipts: 5,
        heartbeats: 0,
        automation: 0
      })
      measurements.push({
        label,
        stageCount: view.stageTasks.length,
        snapshotBytes: byteLength(workflow),
        requirementCodeUnits: input.requirement.length,
        titleCodeUnits: input.title.length,
        createRequestBytes: byteLength(input),
        responseBytes: size,
        viewResponseBytes: byteLength(view),
        acknowledgementBytes,
        structuralTokens,
        nestingDepth,
        persistedViewUpperBound: persistedViewUpperBound(view),
        createReplyUpperBound: upperBound,
        clientMaximumBytes: clientBytes
      })
    }
  )

  it('rejects a schema-valid snapshot one byte over the save cap before any mutation and permits a corrected retry', async () => {
    const f = await fixture()
    const before = await counts(f)
    const attemptedWrites = []
    const checked = createWorkflowDefinitionRepository({
      begin: (run) =>
        h.sql.begin((db) => {
          const checkedDb = (strings, ...values) => {
            if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(strings.join('?'))) {
              attemptedWrites.push(strings[0].trim().split(/\s+/)[0])
            }
            return db(strings, ...values)
          }
          checkedDb.json = (value) => db.json(value)
          return run(checkedDb)
        })
    })
    const input = capacityWorkflow(f.project, workflowBytes + 1)
    await expect(checked.saveWorkflow(f.accountId, input)).rejects.toThrow('INVALID_REQUEST')
    expect(attemptedWrites).toEqual([])
    expect(await counts(f)).toEqual(before)
    const corrected = capacityWorkflow(f.project, workflowBytes)
    corrected.requestId = input.requestId
    const saved = await workflows.saveWorkflow(f.accountId, corrected)
    expect(byteLength(saved)).toBe(workflowBytes)
    expect(await counts(f)).toMatchObject({
      issue_counter: 0,
      issues: 0,
      cases: 0,
      events: 0,
      links: 0,
      bindings: 0,
      stage_issues: 0,
      pipelines: 1,
      pipeline_stages: 34,
      definitions: 1,
      revisions: 1,
      receipts: before.receipts + 1,
      audit: before.audit + 1,
      heartbeats: 0,
      automation: 0
    })
    measurements.push({
      label: 'workflow save boundary',
      rejectedSnapshotBytes: workflowBytes + 1,
      acceptedSnapshotBytes: byteLength(saved),
      attemptedBusinessWritesBeforeRejection: attemptedWrites.length,
      noPartialRows: true
    })
  })
})
