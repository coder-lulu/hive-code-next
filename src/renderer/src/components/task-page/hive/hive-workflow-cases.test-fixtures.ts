import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import type { HiveWorkflowSnapshot } from '../../../../../shared/hive-task-workflows'
import {
  HiveWorkflowCaseSummarySchema,
  HiveWorkflowCaseViewSchema,
  type HiveWorkflowCaseCreate,
  type HiveWorkflowCaseView
} from '../../../../../shared/hive-workflow-cases'
import { workbenchId } from './hive-workbench.test-fixtures'

export function workflowCaseView(
  team: HiveWorkbenchTeam,
  workflow: HiveWorkflowSnapshot,
  value = 200,
  title = 'Private feature request',
  requirement = 'Private feature requirements'
): HiveWorkflowCaseView {
  const id = workbenchId(value)
  return HiveWorkflowCaseViewSchema.parse({
    id,
    title,
    requirement,
    binding: {
      scope: workflow.definition.scope,
      workflowRef: workflow.workflowId,
      workflowRevision: workflow.definition.workflowRevision,
      workflowRunRef: id
    },
    definitionDigest: workflow.definitionDigest,
    projectBindingRevision: workflow.projectBindingRevision,
    revision: 1,
    currentStageRef: workflow.definition.stages[0].stageRef,
    terminalKind: null,
    createdAt: '2026-10-04T02:00:00.000Z',
    updatedAt: '2026-10-04T02:00:00.000Z',
    originTaskId: workbenchId(value * 10),
    workflow,
    team: {
      contractVersion: 1,
      kind: 'workflow.team-binding',
      company: team.company.binding,
      project: team.project.binding,
      employees: team.employees.map((employee) => employee.binding)
    },
    stageTasks: workflow.definition.stages.map((stage, index) => {
      const employee = team.employees.find((candidate) => candidate.binding.role === stage.role)
      if (!employee) {
        throw new Error('Test fixture requires all four employees')
      }
      return {
        stageRef: stage.stageRef,
        taskId: workbenchId(value * 10 + index + 1),
        employeeRef: employee.binding.employeeRef,
        role: stage.role,
        taskRevision: 0,
        status: index ? 'backlog' : 'todo'
      }
    }),
    handoffs: [],
    reviews: [],
    executionNotices: [],
    executionAvailability: { available: false, reason: 'EXECUTION_ISOLATION_UNAVAILABLE' }
  })
}
export function workflowCaseSummary(view: HiveWorkflowCaseView) {
  return HiveWorkflowCaseSummarySchema.parse({
    id: view.id,
    title: view.title,
    binding: view.binding,
    definitionDigest: view.definitionDigest,
    projectBindingRevision: view.projectBindingRevision,
    revision: view.revision,
    currentStageRef: view.currentStageRef,
    terminalKind: view.terminalKind,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt
  })
}
export function submittedWorkflowCase(
  input: HiveWorkflowCaseCreate,
  team: HiveWorkbenchTeam,
  workflow: HiveWorkflowSnapshot
): HiveWorkflowCaseView {
  return workflowCaseView(team, workflow, 200, input.title, input.requirement)
}
