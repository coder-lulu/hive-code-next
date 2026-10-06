import type { HiveWorkflowCaseView } from './hive-workflow-cases'
import { WorkflowExecutionContextSchema } from './task-workflow/workflow-execution-context'

/** Business metadata is fixed to the original Case snapshot, before native authorization. */
export function hiveWorkflowStageContext(view: HiveWorkflowCaseView, stageRef: string) {
  const stage = view.workflow.definition.stages.find((candidate) => candidate.stageRef === stageRef)
  const task = view.stageTasks.find((candidate) => candidate.stageRef === stageRef)
  if (!stage || !task || stage.role !== task.role) {
    throw new Error('REVISION_CONFLICT')
  }
  return WorkflowExecutionContextSchema.parse({
    kind: 'workflow.execution-context',
    binding: view.binding,
    definitionDigest: view.definitionDigest,
    stageRef,
    employeeRef: task.employeeRef,
    role: stage.role,
    handoffRefs: []
  })
}
