import type { HiveWorkflowCaseView } from '../../shared/hive-workflow-cases'
import type { TaskRef } from '../../shared/task-execution/task-execution-primitives'
import { workflowPlanIntentFixture } from '../../shared/task-workflow/workflow-plan-draft.test-fixture'

export function setWorkflowPlanningIntent(view: HiveWorkflowCaseView, sourceTask: TaskRef) {
  const stage = view.stageTasks.find((item) => item.role === 'product')!
  const intent = workflowPlanIntentFixture()
  view.planningIntent = {
    ...intent,
    sourceTask,
    stageRef: stage.stageRef,
    employeeRef: stage.employeeRef,
    facts: {
      ...intent.facts,
      binding: view.binding,
      definitionDigest: view.definitionDigest,
      goalRef: view.originTaskId
    }
  }
}
