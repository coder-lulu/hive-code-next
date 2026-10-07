import type { HiveWorkflowCaseView } from './hive-workflow-cases'
import { WorkflowExecutionContextSchema } from './task-workflow/workflow-execution-context'
import { HiveWorkflowCaseViewSchema } from './hive-workflow-cases'
import { canonicalAgentSessionDigest as digest } from './agent-session-mutation-envelope'

export function hiveWorkflowStageDependencies(view: HiveWorkflowCaseView, stageRef: string) {
  HiveWorkflowCaseViewSchema.parse(view)
  const stage = view.workflow.definition.stages.find((item) => item.stageRef === stageRef)
  const task = view.stageTasks.find((item) => item.stageRef === stageRef)
  if (!stage || !task) {
    throw new Error('REVISION_CONFLICT')
  }
  const latest = (ref: string) =>
    view.handoffs
      .filter((item) => item.stageRef === ref)
      .toSorted((a, b) => b.producer.task.attempt - a.producer.task.attempt)[0]
  const dependencies = stage.dependsOn.map((ref) => {
    const handoff = latest(ref)
    if (
      !handoff ||
      handoff.consumer.stageRef !== stageRef ||
      handoff.consumer.employeeRef !== task.employeeRef
    ) {
      throw new Error('CAPABILITY_UNAVAILABLE')
    }
    return handoff
  })
  const returns = view.workflow.definition.stages
    .filter((item) => item.returnToStageRef === stageRef)
    .map((item) => latest(item.stageRef))
    .filter((item) => item?.consumer.stageRef === stageRef)
  return [...dependencies, ...returns.filter((item) => item !== undefined)]
}

/** Business metadata is fixed to the original Case snapshot, before native authorization. */
export function hiveWorkflowStageContext(view: HiveWorkflowCaseView, stageRef: string) {
  const stage = view.workflow.definition.stages.find((candidate) => candidate.stageRef === stageRef)
  const task = view.stageTasks.find((candidate) => candidate.stageRef === stageRef)
  if (!stage || !task || stage.role !== task.role) {
    throw new Error('REVISION_CONFLICT')
  }
  const dependencies = hiveWorkflowStageDependencies(view, stageRef)
  let code = dependencies.find((item) => item.producer.role === 'developer')
  if (
    stage.role === 'ops' ||
    (stage.role === 'developer' && dependencies.some((item) => item.producer.role === 'tester'))
  ) {
    const tester = dependencies.find((item) => item.producer.role === 'tester')
    const review = view.reviews.find(
      (item) => item.reviewer.task.runId === tester?.producer.task.runId
    )
    code = view.handoffs.find((item) => item.handoffRef === review?.subjectHandoffRef)
    const latestCode = view.handoffs
      .filter((item) => item.producer.role === 'developer')
      .toSorted((a, b) => b.producer.task.attempt - a.producer.task.attempt)[0]
    if (
      !review ||
      !code ||
      code !== latestCode ||
      (stage.role === 'ops' && review.decision !== 'approved') ||
      (stage.role === 'developer' && review.decision === 'approved') ||
      digest({ value: review.codeVersion }) !== digest({ value: code.codeVersion })
    ) {
      throw new Error('CAPABILITY_UNAVAILABLE')
    }
  }
  return WorkflowExecutionContextSchema.parse({
    kind: 'workflow.execution-context',
    binding: view.binding,
    definitionDigest: view.definitionDigest,
    stageRef,
    employeeRef: task.employeeRef,
    role: stage.role,
    handoffRefs: dependencies.map((item) => item.handoffRef),
    ...(code ? { codeInput: { producer: code.producer, version: code.codeVersion } } : {})
  })
}
