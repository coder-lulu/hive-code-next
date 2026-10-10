import { structuredAgentSessionDigest as digest } from '../../../../../shared/structured-agent-session-mutation'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { HiveWorkflowPlanApplicationReceipt } from '../../../../../shared/hive-workflow-plan-application'
import {
  HiveWorkflowPlanGraphViewSchema,
  HiveWorkflowPlanGraphReplySchema,
  type HiveWorkflowPlanGraphStart,
  type HiveWorkflowPlanGraphMutation,
  type HiveWorkflowPlanGraphRetry,
  type HiveWorkflowPlanGraphView
} from '../../../../../shared/hive-workflow-plan-runs'

export function readWorkflowPlanGraph(
  raw: unknown,
  original: HiveWorkflowCaseView,
  application: HiveWorkflowPlanApplicationReceipt
) {
  const page = HiveWorkflowPlanGraphViewSchema.parse(raw)
  const draft = original.planDrafts.find((item) => item.draftRef === application.draftRef)
  if (
    page.caseId !== original.id ||
    page.projectId !== original.binding.scope.projectRef ||
    digest(page.application) !== digest(application) ||
    !draft ||
    digest(page.draft) !== digest(draft) ||
    digest(application.binding) !== digest(original.binding) ||
    application.parentTaskRef !== original.originTaskId ||
    application.projectBindingRevision !== original.projectBindingRevision ||
    page.tasks.some(
      (task) =>
        !original.team.employees.some(
          (employee) => employee.employeeRef === task.employeeRef && employee.role === task.role
        )
    )
  ) {
    throw new Error('REVISION_CONFLICT')
  }
  return page
}

export function readWorkflowPlanGraphReply(
  raw: unknown,
  operation: 'start' | 'cancel' | 'retry' | 'resume',
  input: HiveWorkflowPlanGraphStart | HiveWorkflowPlanGraphMutation | HiveWorkflowPlanGraphRetry,
  original: HiveWorkflowCaseView,
  application: HiveWorkflowPlanApplicationReceipt
) {
  const reply = HiveWorkflowPlanGraphReplySchema.parse(raw)
  const page = readWorkflowPlanGraph(reply.view, original, application)
  if (
    reply.admission.requestId !== input.requestId ||
    reply.admission.payloadFingerprint !==
      digest({ operation: `plans.graph.${operation}`, input }) ||
    !page.graph ||
    ('graphRef' in input && page.graph.graphRef !== input.graphRef) ||
    (operation === 'start' &&
      'requestedDurationMs' in input &&
      page.graph.maxDurationMs !== input.requestedDurationMs)
  ) {
    throw new Error('REVISION_CONFLICT')
  }
  return page
}

export type WorkflowPlanReport = {
  taskId: string
  runId: string
  outcomeRef: string
  artifactRef: string
  artifactDigest: string
  name: string
  text: string
  truncated: boolean
}

export function retainWorkflowPlanReport(
  page: HiveWorkflowPlanGraphView,
  report?: WorkflowPlanReport
) {
  return report &&
    page.tasks.some((task) => task.latestRun?.runId === report.runId) &&
    page.outcomes.some(
      (item) =>
        item.outcomeRef === report.outcomeRef &&
        item.reportVersion.artifactRef === report.artifactRef &&
        item.reportVersion.digest === report.artifactDigest
    )
    ? report
    : undefined
}

export function workflowPlanGraphCanResume(page: HiveWorkflowPlanGraphView) {
  return (
    page.graph?.status === 'paused' &&
    Boolean(page.graph.pauseCause) &&
    page.tasks.every((task) => {
      const run = page.runs.find((item) => item.task.runId === task.latestRun?.runId)
      const outcome = page.outcomes.find(
        (item) => item.producer.task.runId === task.latestRun?.runId
      )
      return (
        (!run || !['unknown', 'cancelRequested', 'failed', 'cancelled'].includes(run.status)) &&
        (!outcome?.review || outcome.review.decision === 'approved')
      )
    })
  )
}
