import type { z } from 'zod'
import type { HiveWorkflowPlanApplicationReceipt } from './hive-workflow-plan-application'
import type {
  HiveWorkflowPlanGraphControl,
  HiveWorkflowPlanGraphTask,
  HiveWorkflowPlanGraphRun,
  HiveWorkflowPlanGraphOutcome
} from './hive-workflow-plan-runs'
import type { WorkflowPlanDraft } from './task-workflow/workflow-plan-draft'
import { workflowPlanApplicationMatchesDraft } from './hive-workflow-plan-application-source'
import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'
import { workflowPlanGraphCompletionRefusal } from './hive-workflow-plan-graph-completion'

export type GraphProjection = {
  caseId: string
  projectId: string
  application: HiveWorkflowPlanApplicationReceipt
  draft: WorkflowPlanDraft
  graph: HiveWorkflowPlanGraphControl | null
  tasks: HiveWorkflowPlanGraphTask[]
  runs: HiveWorkflowPlanGraphRun[]
  outcomes: HiveWorkflowPlanGraphOutcome[]
}

export function validateWorkflowPlanGraph(view: GraphProjection, context: z.RefinementCtx) {
  const reject = (message: string) => context.addIssue({ code: 'custom', message })
  const { application, draft, graph, tasks, runs, outcomes } = view
  const completion = workflowPlanGraphCompletionRefusal(view)
  if (completion) {
    reject(completion)
  }
  if (
    !workflowPlanApplicationMatchesDraft(application, draft) ||
    application.binding.workflowRunRef !== view.caseId ||
    application.binding.scope.projectRef !== view.projectId
  ) {
    reject('workflow_plan_graph_source_mismatch')
  }
  if (draft.inspection.kind !== 'validated') {
    return
  }
  const proposal = draft.inspection.proposal
  if (
    graph &&
    (graph.applicationRef !== application.applicationRef ||
      digest(graph.binding) !== digest(application.binding) ||
      graph.planRevision !== application.planRevision ||
      graph.draftDigest !== application.draftDigest ||
      graph.proposalDigest !== application.proposalDigest ||
      graph.projectBindingRevision !== application.projectBindingRevision ||
      graph.maxParallelism !== proposal.requestedLimits.maxParallelism ||
      graph.maxDurationMs > proposal.requestedLimits.maxDurationMs)
  ) {
    reject('workflow_plan_graph_control_mismatch')
  }
  const taskMap = new Map(tasks.map((task) => [task.proposalTaskRef, task]))
  if (
    taskMap.size !== tasks.length ||
    tasks.length !== application.createdTaskRefs.length ||
    application.createdTaskRefs.some((mapping) => {
      const task = taskMap.get(mapping.proposalTaskRef)
      const planned = proposal.tasks.find((item) => item.taskRef === mapping.proposalTaskRef)
      return (
        !task ||
        !planned ||
        task.taskId !== mapping.taskId ||
        task.employeeRef !== mapping.employeeRef ||
        task.role !== planned.requestedRole ||
        task.maxAttempts !== planned.maxAttempts
      )
    })
  ) {
    reject('workflow_plan_graph_tasks_mismatch')
  }
  const runMap = new Map(runs.map((run) => [run.task.runId, run]))
  if (graph?.pauseCause) {
    const cause = graph.pauseCause
    const source = runMap.get(cause.causeRunId)
    if (
      !source ||
      source.status !== 'succeeded' ||
      !source.hasResult ||
      !outcomes.some(
        (outcome) =>
          outcome.producer.task.runId === cause.causeRunId && outcome.status === 'succeeded'
      ) ||
      (cause.proposalTaskRef !== undefined && !taskMap.has(cause.proposalTaskRef))
    ) {
      reject('workflow_plan_graph_pause_source_mismatch')
    }
  }
  if ((!graph && (runs.length || outcomes.length)) || runMap.size !== runs.length) {
    reject('workflow_plan_graph_runs_mismatch')
  }
  const attempts = new Set<string>()
  for (const run of runs) {
    const task = taskMap.get(run.proposalTaskRef)
    const attemptKey = `${run.task.taskId}:${run.task.attempt}`
    if (
      !graph ||
      !task ||
      run.graphRef !== graph.graphRef ||
      run.applicationRef !== application.applicationRef ||
      run.role !== task.role ||
      run.employeeRef !== task.employeeRef ||
      run.task.taskId !== task.taskId ||
      run.task.spaceId !== application.binding.scope.companyRef ||
      run.task.attempt > task.maxAttempts ||
      attempts.has(attemptKey)
    ) {
      reject('workflow_plan_graph_run_mismatch')
    }
    attempts.add(attemptKey)
  }
  for (const task of tasks) {
    const taskRuns = runs.filter((run) => run.task.taskId === task.taskId)
    const latest = taskRuns.toSorted((a, b) => b.task.attempt - a.task.attempt)[0]
    if (
      taskRuns.length > task.maxAttempts ||
      (task.latestRun ? !latest || digest(latest.task) !== digest(task.latestRun) : Boolean(latest))
    ) {
      reject('workflow_plan_graph_latest_run_mismatch')
    }
  }
  if (
    new Set(outcomes.map((outcome) => outcome.outcomeRef)).size !== outcomes.length ||
    new Set(outcomes.map((outcome) => outcome.producer.task.runId)).size !== outcomes.length
  ) {
    reject('workflow_plan_graph_outcomes_mismatch')
  }
  for (const outcome of outcomes) {
    const run = runMap.get(outcome.producer.task.runId)
    if (
      !graph ||
      !run ||
      outcome.graphRef !== graph.graphRef ||
      outcome.applicationRef !== application.applicationRef ||
      outcome.proposalTaskRef !== run.proposalTaskRef ||
      outcome.producer.role !== run.role ||
      outcome.producer.employeeRef !== run.employeeRef ||
      digest(outcome.producer.task) !== digest(run.task) ||
      !run.hasResult ||
      run.status !== outcome.status
    ) {
      reject('workflow_plan_graph_outcome_mismatch')
    }
    const review = outcome.review
    if (review) {
      const subject = outcomes.find((item) => item.outcomeRef === review.subjectHandoffRef)
      const dependencies = proposal.tasks.find(
        (task) => task.taskRef === outcome.proposalTaskRef
      )?.dependsOn
      if (
        digest(review.binding) !== digest(application.binding) ||
        !subject ||
        !dependencies?.includes(subject.proposalTaskRef) ||
        subject.producer.role !== 'developer' ||
        subject.producer.employeeRef === outcome.producer.employeeRef ||
        subject.producer.task.taskId === outcome.producer.task.taskId ||
        subject.producer.executionId === outcome.producer.executionId ||
        subject.producer.workspaceExecutionClaimRef ===
          outcome.producer.workspaceExecutionClaimRef ||
        subject.codeVersion?.kind !== 'snapshot' ||
        digest(review.codeVersion) !== digest(subject.codeVersion) ||
        digest(review.artifact) !== digest(subject.reportVersion)
      ) {
        reject('workflow_plan_graph_review_mismatch')
      }
    }
  }
  if (
    runs.some((run) => {
      const hasOutcome = outcomes.some((outcome) => outcome.producer.task.runId === run.task.runId)
      return (
        (run.status === 'succeeded' && !hasOutcome) || (run.status === 'cancelled' && hasOutcome)
      )
    })
  ) {
    reject('workflow_plan_graph_result_mismatch')
  }
}
