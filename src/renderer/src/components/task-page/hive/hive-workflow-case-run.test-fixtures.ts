import {
  HiveWorkflowCaseRunSchema,
  type HiveWorkflowCaseRun,
  type HiveWorkflowCaseStart
} from '../../../../../shared/hive-workflow-case-runs'
import {
  HiveWorkflowCaseViewSchema,
  type HiveWorkflowCaseView
} from '../../../../../shared/hive-workflow-cases'
import {
  workbenchCompany,
  workbenchProject,
  workbenchTeam,
  workbenchId
} from './hive-workbench.test-fixtures'
import { workflowSnapshot } from './hive-workflow.test-fixtures'
import { workflowCaseView } from './hive-workflow-cases.test-fixtures'

export function executableWorkflowCase(value = 200) {
  const company = workbenchCompany(1)
  const team = workbenchTeam(company, workbenchProject(3, company), true)
  const view = workflowCaseView(team, workflowSnapshot(team), value)
  return HiveWorkflowCaseViewSchema.parse({
    ...view,
    stageTasks: view.stageTasks.map((task) => ({ ...task, status: 'backlog' })),
    executionAvailability: { available: true, mode: 'docker_linux' }
  })
}
export function workflowCaseRun(
  view: HiveWorkflowCaseView,
  status: HiveWorkflowCaseRun['status'] = 'running',
  runId = workbenchId(900),
  startRequest?: HiveWorkflowCaseStart
) {
  const task = view.stageTasks.find((candidate) => candidate.stageRef === view.currentStageRef)
  if (!task) {
    throw new Error('Test fixture requires a current stage task')
  }
  return HiveWorkflowCaseRunSchema.parse({
    caseId: view.id,
    stageRef: task.stageRef,
    role: task.role,
    employeeRef: task.employeeRef,
    startRequest: startRequest ?? {
      requestId: workbenchId(901),
      projectId: view.binding.scope.projectRef,
      caseId: view.id,
      stageRef: task.stageRef,
      expectedCaseRevision: view.revision,
      expectedTaskRevision: task.taskRevision
    },
    task: {
      spaceId: view.binding.scope.companyRef,
      taskId: task.taskId,
      runId,
      attempt: 1,
      taskRevision: String((startRequest?.expectedTaskRevision ?? task.taskRevision) + 1)
    },
    title: 'Assigned employee stage run',
    status,
    artifactRefs: status === 'succeeded' ? ['artifact:report'] : []
  })
}
