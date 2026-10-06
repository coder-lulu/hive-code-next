import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { createWorkflowCasePostgresFixture } from './paperclip-workflow-cases-postgres-fixture.mjs'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { createWorkflowDefinitionRepository } from '../../integration/paperclip/service/workflow-definition-repository.mjs'
import { createWorkflowCaseRepository } from '../../integration/paperclip/service/workflow-case-repository.mjs'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)('real workflow Case page historical revision keys', () => {
  let h, workbench, workflows, cases
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
    workbench = createTeamWorkbenchRepository(h.sql)
    workflows = createWorkflowDefinitionRepository(h.sql)
    cases = createWorkflowCaseRepository(h.sql)
  })
  afterAll(async () => h?.sql.end({ timeout: 5 }))

  it('keeps distinct frozen project revisions while preloading original and later definition revisions', async () => {
    const f = await createWorkflowCasePostgresFixture({ workbench, workflows, cases })
    const first = (await cases.createWorkflowCase(f.accountId, f.input)).view
    await workbench.configureTeam(f.accountId, {
      requestId: randomUUID(),
      projectId: f.project.id,
      expectedRevision: 2,
      employees: f.employees.map((employee) => ({ ...employee, name: `${employee.role} renamed` }))
    })
    const edited = await workflows.saveWorkflow(f.accountId, {
      ...f.definitionInput,
      requestId: randomUUID(),
      workflowId: f.workflow.workflowId,
      expectedRevision: 1,
      expectedProjectRevision: 3,
      name: 'Later definition revision'
    })
    const second = (
      await cases.createWorkflowCase(f.accountId, {
        ...f.input,
        requestId: randomUUID(),
        expectedProjectRevision: 3,
        workflowRevision: 2,
        definitionDigest: edited.definitionDigest
      })
    ).view
    const third = (
      await cases.createWorkflowCase(f.accountId, {
        ...f.input,
        requestId: randomUUID(),
        expectedProjectRevision: 3
      })
    ).view
    const revisionReads = []
    const reader = createWorkflowCaseRepository({
      begin: (work) =>
        h.sql.begin((tx) => {
          const db = Object.assign(
            (strings, ...values) => {
              if (strings.join('').startsWith('SELECT r.definition_json')) {
                revisionReads.push(values[1])
              }
              return tx(strings, ...values)
            },
            { json: tx.json }
          )
          return work(db)
        })
    })
    const page = await reader.listWorkflowCases(f.accountId, { projectId: f.project.id, limit: 3 })
    expect(page.items.map((item) => item.id)).toEqual([first.id, second.id, third.id].toSorted())
    expect(page.nextCursor).toBeNull()
    expect(revisionReads).toEqual([1, 1, 2])
    for (const view of [first, second, third]) {
      expect(page.items.find((item) => item.id === view.id)).toMatchObject({
        binding: { workflowRevision: view.binding.workflowRevision },
        projectBindingRevision: view.projectBindingRevision,
        definitionDigest: view.definitionDigest
      })
      const current = await cases.getWorkflowCase(f.accountId, {
        projectId: f.project.id,
        caseId: view.id
      })
      expect(current.workflow.projectBindingRevision).toBe(view.projectBindingRevision)
      expect(current.workflow.definition.workflowRevision).toBe(view.binding.workflowRevision)
      expect(current.team).toEqual(view.team)
    }
  })
})
