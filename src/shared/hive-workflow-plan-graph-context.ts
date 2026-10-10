import {
  WORKFLOW_ROLE_INSTRUCTIONS,
  workflowRoleCompletion
} from './task-workflow/workflow-role-completion'
import type { HiveWorkflowCaseView } from './hive-workflow-cases'
import type { HiveWorkflowPlanGraphView } from './hive-workflow-plan-runs'
import type { TaskRef } from './task-execution/task-execution-primitives'
import {
  WorkflowExecutionContextSchema,
  type WorkflowExecutionContext
} from './task-workflow/workflow-execution-context'
import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'
const refuse = (reason: string): never => {
  throw new Error(reason)
}
export function hiveWorkflowPlanGraphContext(
  originalCase: HiveWorkflowCaseView,
  graphView: HiveWorkflowPlanGraphView,
  proposalTaskRef: string,
  task: TaskRef
) {
  const proposed =
    graphView.draft.inspection.kind === 'validated'
      ? graphView.draft.inspection.proposal.tasks.find((item) => item.taskRef === proposalTaskRef)
      : undefined
  if (!proposed || !graphView.graph) {
    throw new Error('REVISION_CONFLICT')
  }
  const { graph, outcomes, application } = graphView
  const dependencies = proposed.dependsOn.map((ref) => {
    const outcome = outcomes
      .filter((item) => item.proposalTaskRef === ref)
      .sort((a, b) => b.producer.task.attempt - a.producer.task.attempt)[0]
    if (
      !outcome ||
      outcome.status !== 'succeeded' ||
      (outcome.review && outcome.review.decision !== 'approved')
    ) {
      refuse('CAPABILITY_UNAVAILABLE')
    }
    return outcome
  })
  let code = dependencies.find((item) => item.producer.role === 'developer')
  if (proposed.requestedRole === 'ops') {
    const review = dependencies.find((item) => item.review)?.review
    code = outcomes.find((item) => item.outcomeRef === review?.subjectHandoffRef)
    if (
      !review ||
      review.decision !== 'approved' ||
      !code ||
      !code.codeVersion ||
      digest(code.codeVersion) !== digest(review.codeVersion)
    ) {
      refuse('CAPABILITY_UNAVAILABLE')
    }
  }
  const mapping = application.createdTaskRefs.find(
    (item) => item.proposalTaskRef === proposed.taskRef
  )
  if (!mapping) {
    throw new Error('REVISION_CONFLICT')
  }
  return WorkflowExecutionContextSchema.parse({
    kind: 'workflow.execution-context',
    binding: application.binding,
    definitionDigest: originalCase.definitionDigest,
    stageRef: proposed.taskRef,
    employeeRef: mapping.employeeRef,
    role: proposed.requestedRole,
    handoffRefs: dependencies.map((item) => item.outcomeRef),
    planExecution: {
      graphRef: graph.graphRef,
      applicationRef: application.applicationRef,
      planRevision: application.planRevision,
      draftDigest: application.draftDigest,
      proposalDigest: application.proposalDigest,
      proposalTaskRef: proposed.taskRef,
      sourceTask: task,
      dependencyOutcomes: dependencies.map((item) => ({
        proposalTaskRef: item.proposalTaskRef,
        producer: item.producer,
        outcomeRef: item.outcomeRef,
        outcomeVersion: item.nativeOutcomeVersion
      }))
    },
    ...(code ? { codeInput: { producer: code.producer, version: code.codeVersion } } : {})
  })
}

export function hiveWorkflowPlanGraphPrompt(
  originalCase: HiveWorkflowCaseView,
  graphView: HiveWorkflowPlanGraphView,
  proposalTaskRef: string,
  context: WorkflowExecutionContext
) {
  const proposed =
    graphView.draft.inspection.kind === 'validated'
      ? graphView.draft.inspection.proposal.tasks.find((item) => item.taskRef === proposalTaskRef)
      : undefined
  if (!proposed) {
    throw new Error('REVISION_CONFLICT')
  }
  return JSON.stringify({
    instruction: `Execute this adopted plan task only. Follow its acceptance criteria and exact dependency versions. ${WORKFLOW_ROLE_INSTRUCTIONS[proposed.requestedRole]} Include the named report in the original result manifest. Never claim tests without actual independent runner evidence. Do not deploy or start detached processes.`,
    roleCompletion: workflowRoleCompletion(context).join('\n\n'),
    task: proposed,
    context,
    sourceInputs: originalCase.requirement,
    sourceAssets: originalCase.handoffs.map((item) => ({
      stageRef: item.stageRef,
      handoffRef: item.handoffRef,
      artifact: item.artifact,
      codeVersion: item.codeVersion,
      summary: item.summary
    })),
    dependencies: graphView.outcomes
      .filter((item) =>
        context.planExecution?.dependencyOutcomes.some(
          (dependency) => dependency.outcomeRef === item.outcomeRef
        )
      )
      .map((item) => ({
        proposalTaskRef: item.proposalTaskRef,
        outcomeRef: item.outcomeRef,
        summary: item.summary,
        reportVersion: item.reportVersion,
        ...(item.codeVersion ? { codeVersion: item.codeVersion } : {}),
        ...(item.review
          ? {
              review: {
                reviewRef: item.review.reviewRef,
                decision: item.review.decision,
                subjectHandoffRef: item.review.subjectHandoffRef,
                codeVersion: item.review.codeVersion,
                testReport: item.review.testReport
              }
            }
          : {})
      }))
  })
}
