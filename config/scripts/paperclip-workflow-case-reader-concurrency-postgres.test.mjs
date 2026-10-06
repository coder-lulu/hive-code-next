import crypto, { randomUUID } from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { createWorkflowCasePostgresFixture } from './paperclip-workflow-cases-postgres-fixture.mjs'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { createWorkflowDefinitionRepository } from '../../integration/paperclip/service/workflow-definition-repository.mjs'
import { createWorkflowCaseRepository } from '../../integration/paperclip/service/workflow-case-repository.mjs'
import { createWorkflowCaseRunRepository } from '../../integration/paperclip/service/workflow-case-run-repository.mjs'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG

function gate() {
  let open
  const ready = new Promise((resolve) => {
    open = resolve
  })
  return { ready, open }
}

describe.skipIf(!configPath)('real concurrent workflow Case readers', () => {
  let h, workbench, workflows, cases, runs
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
    workbench = createTeamWorkbenchRepository(h.sql)
    workflows = createWorkflowDefinitionRepository(h.sql)
    cases = createWorkflowCaseRepository(h.sql)
    runs = createWorkflowCaseRunRepository(h.sql)
  })
  afterAll(async () => h?.sql.end({ timeout: 5 }))

  async function fixture(repair) {
    const f = await createWorkflowCasePostgresFixture({ workbench, workflows, cases })
    const { view } = await cases.createWorkflowCase(f.accountId, f.input)
    const product = view.stageTasks.find((stage) => stage.role === 'product')
    const admission = await runs.startWorkflowCase(f.accountId, {
      requestId: randomUUID(),
      projectId: f.project.id,
      caseId: view.id,
      stageRef: product.stageRef,
      expectedCaseRevision: view.revision,
      expectedTaskRevision: product.taskRevision
    })
    // Exercise a reader of the review row itself, without claiming native execution or approval.
    await h.sql`UPDATE pipeline_cases SET stage_id=(SELECT id FROM pipeline_stages
      WHERE pipeline_id=${f.workflow.workflowId} AND kind='review') WHERE id=${view.id}`
    if (repair) {
      await h.sql`UPDATE pipeline_stages SET config=jsonb_build_object('hiveWorkflow',config->'hiveWorkflow')
        WHERE pipeline_id=${f.workflow.workflowId} AND kind='review'`
    }
    return { ...f, view, admission }
  }

  async function readConcurrently(f) {
    const bothLookups = gate(),
      aHead = gate(),
      bHeadStarted = gate()
    const pids = {},
      trace = []
    let lookupCount = 0
    function reader(lane) {
      let lookupSeen = false
      return createWorkflowCaseRepository({
        begin: (work) =>
          h.sql.begin(async (tx) => {
            const [session] = await tx`SELECT pg_backend_pid() AS pid`
            pids[lane] = session.pid
            const db = Object.assign(
              async (strings, ...values) => {
                const query = strings.join('?').replaceAll(/\s+/g, ' ').trim()
                const head = query.startsWith('SELECT h.*')
                const lookup =
                  query.startsWith(
                    'SELECT workflow_id,workflow_revision,project_binding_revision'
                  ) ||
                  (query.startsWith('SELECT c.*,b.account_id') && !lookupSeen)
                if (head && lane === 'B') {
                  await aHead.ready
                  bHeadStarted.open()
                }
                const result = await tx(strings, ...values)
                if (lookup) {
                  lookupSeen = true
                  if (++lookupCount === 2) {
                    bothLookups.open()
                  }
                  await bothLookups.ready
                }
                if (head && lane === 'A') {
                  trace.push('A holds the original pipeline lock')
                  aHead.open()
                  await bHeadStarted.ready
                  await expect
                    .poll(
                      async () => {
                        const [state] =
                          await h.sql`SELECT ${pids.A}::int=ANY(pg_blocking_pids(${pids.B}::int)) AS waiting`
                        return state.waiting
                      },
                      { timeout: 5000, interval: 10 }
                    )
                    .toBe(true)
                  const locks = await h.sql`SELECT locktype,mode,granted FROM pg_locks
              WHERE pid=${pids.B} AND NOT granted`
                  expect(locks.some((lock) => lock.granted === false)).toBe(true)
                  trace.push('PostgreSQL confirms B waits for A before A reads the Case/stage')
                }
                return result
              },
              { json: tx.json }
            )
            return work(db)
          })
      })
    }
    const query = { projectId: f.project.id, caseId: f.view.id }
    const values = await Promise.all([
      reader('A').getWorkflowCase(f.accountId, query),
      reader('B').getWorkflowCase(f.accountId, query)
    ])
    expect(trace).toHaveLength(2)
    return values
  }

  it.each([false, true])(
    'serializes canonical/repair=%s readers without lock inversion or business changes',
    async (repair) => {
      const f = await fixture(repair)
      const [before] =
        await h.sql`SELECT version,updated_at FROM pipeline_cases WHERE id=${f.view.id}`
      const [intent] = await h.sql`SELECT workflow_input,input_fingerprint FROM hive_task_bindings
      WHERE run_id=${f.admission.run.task.runId}`
      const values = await readConcurrently(f)
      expect(values[0]).toEqual(values[1])
      expect(values[0].id).toBe(f.view.id)
      expect(
        (await h.sql`SELECT version,updated_at FROM pipeline_cases WHERE id=${f.view.id}`)[0]
      ).toEqual(before)
      expect(
        (
          await h.sql`SELECT workflow_input,input_fingerprint FROM hive_task_bindings
      WHERE run_id=${f.admission.run.task.runId}`
        )[0]
      ).toEqual(intent)
      expect(
        await h.sql`SELECT id FROM pipeline_case_events WHERE case_id=${f.view.id}
      AND payload->>'kind'='hive.workflow.review_policy_repaired'`
      ).toHaveLength(repair ? 1 : 0)
      expect(
        await h.sql`SELECT id FROM activity_log WHERE company_id=${f.company.id}
      AND action='hive.workflow.review_policy_repaired'`
      ).toHaveLength(repair ? 1 : 0)
    }
  )

  it('locks two workflows in one order while retaining the opposite Case page order', async () => {
    const f = await createWorkflowCasePostgresFixture({ workbench, workflows, cases })
    const other = await workflows.saveWorkflow(f.accountId, {
      ...f.definitionInput,
      requestId: randomUUID(),
      name: 'Second concurrent workflow'
    })
    const ordered = [f.workflow, other].toSorted((a, b) => (a.workflowId < b.workflowId ? -1 : 1))
    const ids = [`f${randomUUID().slice(1)}`, `1${randomUUID().slice(1)}`]
    for (const [index, workflow] of ordered.entries()) {
      const input = {
        ...f.input,
        requestId: randomUUID(),
        workflowId: workflow.workflowId,
        workflowRevision: workflow.definition.workflowRevision,
        definitionDigest: workflow.definitionDigest
      }
      const original = crypto.randomUUID
      const stub = vi
        .spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce(original())
        .mockReturnValueOnce(ids[index])
        .mockImplementation(original)
      syncBuiltinESMExports()
      try {
        expect((await cases.createWorkflowCase(f.accountId, input)).view.id).toBe(ids[index])
      } finally {
        stub.mockRestore()
        syncBuiltinESMExports()
      }
    }
    const firstDefinition = gate(),
      caseHeadStarted = gate(),
      caseHeadLocked = gate()
    const pids = {}
    let caseHeadId
    function connection(lane) {
      let first = true
      return {
        begin: (work) =>
          h.sql.begin(async (tx) => {
            const [session] = await tx`SELECT pg_backend_pid() AS pid`
            pids[lane] = session.pid
            const db = Object.assign(
              async (strings, ...values) => {
                const query = strings.join('?').replaceAll(/\s+/g, ' ').trim()
                const head = query.startsWith('SELECT h.*') && first
                if (head && lane === 'Cases') {
                  await firstDefinition.ready
                  caseHeadId = values[0]
                  caseHeadStarted.open()
                }
                const result = await tx(strings, ...values)
                if (head) {
                  first = false
                  if (lane === 'Definitions') {
                    firstDefinition.open()
                    await caseHeadStarted.ready
                    await (caseHeadId === ordered[0].workflowId
                      ? expect
                          .poll(
                            async () => {
                              const [state] =
                                await h.sql`SELECT ${pids.Definitions}::int=ANY(pg_blocking_pids(${pids.Cases}::int)) AS waiting`
                              return state.waiting
                            },
                            { timeout: 5000, interval: 10 }
                          )
                          .toBe(true)
                      : caseHeadLocked.ready)
                  } else {
                    caseHeadLocked.open()
                  }
                }
                return result
              },
              { json: tx.json }
            )
            return work(db)
          })
      }
    }
    const results = await Promise.allSettled([
      createWorkflowDefinitionRepository(connection('Definitions')).listWorkflows(f.accountId, {
        projectId: f.project.id
      }),
      createWorkflowCaseRepository(connection('Cases')).listWorkflowCases(f.accountId, {
        projectId: f.project.id
      })
    ])
    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    expect(results[1].value.items.map((item) => item.id)).toEqual(ids.toSorted())
    const paged = [],
      flow = [],
      pageHeads = []
    const pageReader = createWorkflowCaseRepository({
      begin: (work) =>
        h.sql.begin((tx) => {
          const db = Object.assign(
            (strings, ...values) => {
              if (strings.join('').startsWith('SELECT h.*')) {
                pageHeads.push(values[0])
              }
              return tx(strings, ...values)
            },
            { json: tx.json }
          )
          return work(db)
        })
    })
    let after
    do {
      pageHeads.length = 0
      const page = await pageReader.listWorkflowCases(f.accountId, {
        projectId: f.project.id,
        limit: 1,
        ...(after ? { after } : {})
      })
      paged.push(...page.items.map((item) => item.id))
      expect(pageHeads).toEqual(page.items.map((item) => item.binding.workflowRef))
      flow.push(...page.items.map((item) => item.binding.workflowRef))
      after = page.nextCursor
    } while (after)
    expect(paged).toEqual(ids.toSorted())
    expect(flow).toEqual(ordered.toReversed().map((item) => item.workflowId))
  })
})
