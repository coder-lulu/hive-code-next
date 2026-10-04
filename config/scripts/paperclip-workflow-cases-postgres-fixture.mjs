import { randomUUID } from 'node:crypto'
import { workflowTestVectors } from '../../src/shared/task-workflow/workflow.test-fixture.ts'

export async function createWorkflowCasePostgresFixture(
  { workbench, workflows, cases },
  configure = true,
  stages = workflowTestVectors.examples.definition.stages
) {
  const accountId = `workflow-cases-postgres:${randomUUID()}`
  const company = await workbench.createCompany(accountId, {
    requestId: randomUUID(),
    name: 'Requirement cases fixture'
  })
  const project = await workbench.createProject(accountId, {
    requestId: randomUUID(),
    companyId: company.id,
    name: 'Feature project',
    workspaceSelector: 'folder:requirement-fixture',
    hiveWorkspaceRef: `workspace:${randomUUID()}`
  })
  const employees = ['product', 'developer', 'tester', 'ops'].map((role) => ({
    role,
    name: role,
    profileRef: 'codex',
    profileRevision: 'codex:1'
  }))
  const team = configure
    ? await workbench.configureTeam(accountId, {
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: 1,
        employees
      })
    : null
  const definitionInput = {
    requestId: randomUUID(),
    projectId: project.id,
    expectedRevision: 0,
    expectedProjectRevision: configure ? 2 : 1,
    name: 'Feature delivery definition',
    stages: structuredClone(stages),
    maxParallelism: 1,
    maxDurationMs: 60_000
  }
  const workflow = await workflows.saveWorkflow(accountId, definitionInput)
  const input = {
    requestId: randomUUID(),
    projectId: project.id,
    workflowId: workflow.workflowId,
    workflowRevision: 1,
    definitionDigest: workflow.definitionDigest,
    expectedProjectRevision: definitionInput.expectedProjectRevision,
    title: 'Provide a real small feature',
    requirement: 'Implement the feature and prepare independent test evidence.'
  }
  const read = (caseId) => cases.getWorkflowCase(accountId, { projectId: project.id, caseId })
  return { accountId, company, project, team, employees, definitionInput, workflow, input, read }
}
