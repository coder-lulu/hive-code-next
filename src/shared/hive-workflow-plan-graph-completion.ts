import type { GraphProjection } from './hive-workflow-plan-graph-validation'
import { workflowReviewBindingRefusal } from './task-workflow/workflow-binding-checks'

export function workflowPlanGraphCompletionRefusal(view: GraphProjection): string | null {
  const status = view.graph?.status
  if (status !== 'done' && status !== 'cancelled') {
    return null
  }
  if (view.runs.some((run) => !['succeeded', 'failed', 'cancelled'].includes(run.status))) {
    return 'workflow_plan_graph_unsettled_completion'
  }
  if (status === 'cancelled') {
    return view.tasks.every((task) => task.status === 'done' || task.status === 'cancelled')
      ? null
      : 'workflow_plan_graph_cancelled_task_mismatch'
  }
  const latest = view.tasks.map((task) => {
    const run = view.runs.find((item) => item.task.runId === task.latestRun?.runId)
    return task.status === 'done' && run?.status === 'succeeded' && run.hasResult
      ? view.outcomes.find((outcome) => outcome.producer.task.runId === run.task.runId)
      : undefined
  })
  if (latest.some((outcome) => !outcome || outcome.status !== 'succeeded')) {
    return 'workflow_plan_graph_incomplete_tasks'
  }
  for (const developer of latest) {
    if (developer?.producer.role !== 'developer') {
      continue
    }
    const reviews = latest.filter(
      (outcome) => outcome?.review?.subjectHandoffRef === developer.outcomeRef
    )
    if (developer.codeVersion?.kind !== 'snapshot' || reviews.length !== 1) {
      return 'workflow_plan_graph_independent_review_required'
    }
    const review = reviews[0]!.review!
    if (
      review.decision !== 'approved' ||
      workflowReviewBindingRefusal(
        {
          contractVersion: 1,
          kind: 'workflow.handoff',
          handoffRef: developer.outcomeRef,
          binding: view.application.binding,
          stageRef: developer.proposalTaskRef,
          producer: developer.producer,
          consumer: {
            stageRef: review.stageRef,
            employeeRef: review.reviewer.employeeRef,
            role: 'tester'
          },
          artifact: developer.reportVersion,
          codeVersion: developer.codeVersion,
          dependencyVersions: [],
          summary: developer.summary,
          audienceScope: {
            scope: view.application.binding.scope,
            employeeRefs: [review.reviewer.employeeRef]
          }
        },
        review
      )
    ) {
      return 'workflow_plan_graph_independent_review_required'
    }
  }
  return null
}
