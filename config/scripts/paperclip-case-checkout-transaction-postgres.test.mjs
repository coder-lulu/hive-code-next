import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { createWorkflowCasePostgresFixture } from './paperclip-workflow-cases-postgres-fixture.mjs'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { createWorkflowDefinitionRepository } from '../../integration/paperclip/service/workflow-definition-repository.mjs'
import { createWorkflowCaseRepository } from '../../integration/paperclip/service/workflow-case-repository.mjs'
import { createWorkflowCaseRunRepository } from '../../integration/paperclip/service/workflow-case-run-repository.mjs'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)('original checkout guards on the same real transaction', () => {
  let h, workbench, workflows, cases
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
    workbench = createTeamWorkbenchRepository(h.sql)
    workflows = createWorkflowDefinitionRepository(h.sql)
    cases = createWorkflowCaseRepository(h.sql)
  })
  afterAll(async () => h?.sql.end({ timeout: 5 }))
  async function fixture() {
    const f = await createWorkflowCasePostgresFixture({ workbench, workflows, cases })
    const { view } = await cases.createWorkflowCase(f.accountId, f.input)
    const fixed = view.stageTasks.find((task) => task.stageRef === view.currentStageRef)
    return {
      ...f,
      view,
      fixed,
      start: {
        requestId: randomUUID(),
        projectId: f.project.id,
        caseId: view.id,
        expectedCaseRevision: 1,
        stageRef: fixed.stageRef,
        expectedTaskRevision: 0
      }
    }
  }
  it('sees an uncommitted ancestor pause through the original Drizzle reader and preserves postgres-js parsers', async () => {
    const f = await fixture(),
      holdId = randomUUID()
    const before = { date: h.sql.options.parsers[1184], json: h.sql.options.parsers[3802] }
    await h.sql.begin(async (db) => {
      await db`INSERT INTO issue_tree_holds(id,company_id,root_issue_id,mode,status,reason)
        VALUES(${holdId},${f.company.id},${f.view.originTaskId},'pause','active','Uncommitted pause')`
      const reader = createWorkflowCaseRunRepository({ begin: (work) => work(db) })
      await expect(reader.startWorkflowCase(f.accountId, f.start)).rejects.toThrow(
        'REVISION_CONFLICT'
      )
      const [date] =
        await db`SELECT clock_timestamp() AS at,${db.json({ unchanged: true })}::jsonb AS body`
      expect(date.at).toBeInstanceOf(Date)
      expect(date.body).toEqual({ unchanged: true })
      await db`DELETE FROM issue_tree_holds WHERE id=${holdId}`
    })
    expect(h.sql.options.parsers[1184]).toBe(before.date)
    expect(h.sql.options.parsers[3802]).toBe(before.json)
    const [count] =
      await h.sql`SELECT count(*)::int AS n FROM heartbeat_runs WHERE company_id=${f.company.id}`
    expect(count.n).toBe(0)
  })
  it.each(['todo', 'cancelled', 'done'])(
    'uses the original blocker readiness for %s',
    async (status) => {
      const f = await fixture(),
        blocker = randomUUID()
      await h.sql`INSERT INTO issues(id,company_id,project_id,title,status) VALUES(${blocker},${f.company.id},${f.project.id},'Blocker',${status})`
      await h.sql`INSERT INTO issue_relations(company_id,issue_id,related_issue_id,type)
      VALUES(${f.company.id},${blocker},${f.fixed.taskId},'blocks')`
      const runs = createWorkflowCaseRunRepository(h.sql)
      if (status === 'done') {
        expect((await runs.startWorkflowCase(f.accountId, f.start)).run.status).toBe('pending')
      } else {
        await expect(runs.startWorkflowCase(f.accountId, f.start)).rejects.toThrow(
          'REVISION_CONFLICT'
        )
      }
    }
  )
  it('retains immutable run input through repeated DDL and refuses a changed deadline or prompt', async () => {
    const f = await fixture(),
      runs = createWorkflowCaseRunRepository(h.sql)
    const admission = await runs.startWorkflowCase(f.accountId, f.start)
    const [row] =
      await h.sql`SELECT workflow_input FROM hive_task_bindings WHERE run_id=${admission.run.task.runId}`
    for (const changed of [
      { ...row.workflow_input, input: 'Mutated prompt' },
      {
        ...row.workflow_input,
        executionDeadlineAt: new Date(Date.now() + 86_400_000).toISOString()
      }
    ]) {
      await expect(h.sql`UPDATE hive_task_bindings SET workflow_input=${h.sql.json(changed)}
        WHERE run_id=${admission.run.task.runId}`).rejects.toThrow('immutable')
    }
    expect((await runs.startWorkflowCase(f.accountId, f.start)).executionDeadlineAt).toBe(
      admission.executionDeadlineAt
    )
  })
})
