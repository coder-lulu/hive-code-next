import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { createPlanApplicationPostgresFixture } from './paperclip-workflow-plan-application-postgres-fixture.mjs'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { createWorkflowPlanApplicationRepository } from '../../integration/paperclip/service/workflow-plan-application-repository.mjs'
import { createWorkflowCaseRepository } from '../../integration/paperclip/service/workflow-case-repository.mjs'

function gate() {
  let open
  return {
    ready: new Promise((resolve) => {
      open = resolve
    }),
    open: () => open()
  }
}
const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)('plan adoption and project reader lock order', () => {
  let h
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
  })
  afterAll(async () => {
    await h?.sql.end({ timeout: 5 })
  })
  it('finishes a project reader holding company SHARE while an adoption writer waits', async () => {
    const f = await createPlanApplicationPostgresFixture(h)
    const readerHoldingCompany = gate(),
      releaseReader = gate(),
      writerStarted = gate()
    let readerPid, writerPid
    const reader = createTeamWorkbenchRepository({
      begin: (work) =>
        h.sql.begin(async (tx) => {
          readerPid = (await tx`SELECT pg_backend_pid() AS pid`)[0].pid
          let header = false
          const db = Object.assign(
            async (strings, ...values) => {
              const result = await tx(strings, ...values)
              if (
                !header &&
                strings.join('?').includes('FROM companies c JOIN hive_workbench_company_bindings')
              ) {
                header = true
                readerHoldingCompany.open()
                await releaseReader.ready
              }
              return result
            },
            { json: tx.json }
          )
          return work(db)
        })
    })
    const writer = createWorkflowPlanApplicationRepository({
      begin: (work) =>
        h.sql.begin(async (tx) => {
          writerPid = (await tx`SELECT pg_backend_pid() AS pid`)[0].pid
          writerStarted.open()
          return work(tx)
        })
    })
    const reading = reader.listProjects(f.accountId, { companyId: f.company.id })
    await readerHoldingCompany.ready
    const applying = writer.applyWorkflowPlan(f.accountId, f.input)
    await writerStarted.ready
    try {
      await expect
        .poll(
          async () => {
            const [state] =
              await h.sql`SELECT ${readerPid}::int=ANY(pg_blocking_pids(${writerPid}::int)) AS waiting`
            return state.waiting
          },
          { timeout: 5000, interval: 10 }
        )
        .toBe(true)
    } finally {
      releaseReader.open()
    }
    const [projects, applied] = await Promise.all([reading, applying])
    expect(projects.items.some((project) => project.id === f.project.id)).toBe(true)
    expect(applied.view.application.createdTaskRefs).toHaveLength(f.proposal.tasks.length)
    expect(
      (
        await h.sql`SELECT issue_id FROM hive_workflow_plan_application_tasks
      WHERE application_id=${applied.view.application.applicationRef}`
      ).length
    ).toBe(f.proposal.tasks.length)
  })
  it('finishes a canonical Case reader holding pipeline before the plan reader locks its Case', async () => {
    const f = await createPlanApplicationPostgresFixture(h)
    const holdingPipeline = gate(),
      releaseReader = gate(),
      planStarted = gate()
    let readerPid, planPid
    const reader = createWorkflowCaseRepository({
      begin: (work) =>
        h.sql.begin(async (tx) => {
          readerPid = (await tx`SELECT pg_backend_pid() AS pid`)[0].pid
          let head = false
          const db = Object.assign(
            async (strings, ...values) => {
              const result = await tx(strings, ...values)
              if (!head && strings.join('?').trim().startsWith('SELECT h.*')) {
                head = true
                holdingPipeline.open()
                await releaseReader.ready
              }
              return result
            },
            { json: tx.json }
          )
          return work(db)
        })
    })
    const plans = createWorkflowPlanApplicationRepository({
      begin: (work) =>
        h.sql.begin(async (tx) => {
          planPid = (await tx`SELECT pg_backend_pid() AS pid`)[0].pid
          planStarted.open()
          return work(tx)
        })
    })
    const reading = reader.getWorkflowCase(f.accountId, {
      projectId: f.project.id,
      caseId: f.view.id
    })
    await holdingPipeline.ready
    const inspecting = plans.getWorkflowPlanApplication(f.accountId, f.query)
    await planStarted.ready
    try {
      await expect
        .poll(
          async () => {
            const [state] =
              await h.sql`SELECT ${readerPid}::int=ANY(pg_blocking_pids(${planPid}::int)) AS waiting`
            return state.waiting
          },
          { timeout: 5000, interval: 10 }
        )
        .toBe(true)
    } finally {
      releaseReader.open()
    }
    const [view, page] = await Promise.all([reading, inspecting])
    expect(view.id).toBe(page.caseId)
    expect(page.draft).toEqual(f.draft)
    expect(page.eligibility.available).toBe(true)
  })
})
