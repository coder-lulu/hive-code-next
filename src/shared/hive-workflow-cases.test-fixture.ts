import { createHash, randomUUID } from 'node:crypto'
import { canonicalAgentSessionDigest } from './agent-session-mutation-envelope'
import type { HiveWorkbenchTeam } from './hive-team-workbench'
import { HiveWorkflowCaseCreateSchema, HiveWorkflowCaseViewSchema } from './hive-workflow-cases'
import { workflowTestVectors } from './task-workflow/workflow.test-fixture'

export function workflowCaseFixture(accountId = 'workflow-case-owner') {
  const companyId = randomUUID(),
    projectId = randomUUID(),
    caseId = randomUUID()
  const accountDigest = createHash('sha256').update(JSON.stringify(accountId)).digest('hex')
  const owner = `account:${accountDigest}`
  const binding = structuredClone(workflowTestVectors.examples.team)
  binding.company.companyRef = companyId
  binding.company.ownerScope = { kind: 'personalTenant', tenantRef: owner }
  binding.company.ownerAccountRef = owner
  binding.company.ownerActorRef = `actor:${accountDigest}`
  binding.project.scope = { companyRef: companyId, projectRef: projectId }
  binding.project.hiveWorkspaceRef = 'workspace:case-fixture'
  binding.project.bindingRevision = 2
  for (const employee of binding.employees) {
    employee.scope = binding.project.scope
    employee.employeeRef = randomUUID()
    employee.profileRef = 'codex'
    employee.profileRevision = 'codex:1'
    employee.bindingRevision = 2
  }
  const definition = structuredClone(workflowTestVectors.examples.definition)
  definition.scope = binding.project.scope
  definition.workflowRef = randomUUID()
  definition.workflowRevision = 3
  const workflow = {
    workflowId: definition.workflowRef,
    name: 'Feature delivery',
    definition,
    definitionDigest: canonicalAgentSessionDigest({ name: 'Feature delivery', definition }),
    projectBindingRevision: 2
  }
  const team: HiveWorkbenchTeam = {
    company: { id: companyId, name: 'Team', binding: binding.company },
    project: {
      id: projectId,
      companyId,
      name: 'Project',
      workspaceSelector: 'folder:source',
      binding: binding.project
    },
    employees: binding.employees.map((employee) => ({ name: employee.role, binding: employee })),
    executionAvailability: { available: false, reason: 'EXECUTION_ISOLATION_UNAVAILABLE' }
  }
  const input = HiveWorkflowCaseCreateSchema.parse({
    requestId: randomUUID(),
    projectId,
    workflowId: workflow.workflowId,
    workflowRevision: definition.workflowRevision,
    definitionDigest: workflow.definitionDigest,
    expectedProjectRevision: 2,
    title: 'Implement the requested small feature',
    requirement: 'Provide the feature, independent test evidence and release preparation.'
  })
  const view = HiveWorkflowCaseViewSchema.parse({
    id: caseId,
    title: input.title,
    requirement: input.requirement,
    binding: {
      scope: definition.scope,
      workflowRef: workflow.workflowId,
      workflowRevision: definition.workflowRevision,
      workflowRunRef: caseId
    },
    definitionDigest: workflow.definitionDigest,
    projectBindingRevision: 2,
    revision: 1,
    currentStageRef: definition.stages.find((stage) => stage.dependsOn.length === 0)?.stageRef,
    terminalKind: null,
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
    originTaskId: randomUUID(),
    workflow,
    team: binding,
    stageTasks: definition.stages.map((stage) => ({
      stageRef: stage.stageRef,
      taskId: randomUUID(),
      employeeRef: binding.employees.find((employee) => employee.role === stage.role)?.employeeRef,
      role: stage.role,
      taskRevision: 0,
      status: 'backlog'
    })),
    executionAvailability: team.executionAvailability
  })
  const {
    requirement: _requirement,
    originTaskId: _origin,
    workflow: _workflow,
    team: _team,
    stageTasks: _tasks,
    executionAvailability: _availability,
    ...summary
  } = view
  return { input, view, summary, team, workflow }
}
