import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import type { HiveWorkflowCaseView } from '../../shared/hive-workflow-cases'
import type {
  HiveWorkflowPlanGraphQuery,
  HiveWorkflowPlanGraphView
} from '../../shared/hive-workflow-plan-runs'
import { refuseTaskExecution } from './task-execution-error'

export function assertWorkflowPlanGraphSource(
  view: HiveWorkflowPlanGraphView,
  query: HiveWorkflowPlanGraphQuery,
  original: HiveWorkflowCaseView
) {
  const application = view.application
  const draft = original.planDrafts.find((item) => item.draftRef === application.draftRef)
  if (
    original.id !== query.caseId ||
    original.binding.scope.projectRef !== query.projectId ||
    view.caseId !== query.caseId ||
    view.projectId !== query.projectId ||
    application.applicationRef !== query.applicationRef ||
    !draft ||
    digest(draft) !== digest(view.draft) ||
    digest(application.binding) !== digest(original.binding) ||
    application.parentTaskRef !== original.originTaskId ||
    application.projectBindingRevision !== original.projectBindingRevision ||
    view.tasks.some(
      (task) =>
        original.stageTasks.some((stage) => stage.taskId === task.taskId) ||
        !original.team.employees.some(
          (employee) => employee.role === task.role && employee.employeeRef === task.employeeRef
        )
    )
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
}
