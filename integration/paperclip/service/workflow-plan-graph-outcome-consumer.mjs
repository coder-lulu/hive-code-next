import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { HiveWorkflowPlanGraphOutcomeSchema } from '../../../src/shared/hive-workflow-plan-runs.ts'
import { WorkflowReviewSchema } from '../../../src/shared/task-workflow/workflow-evidence.ts'
import { workflowReviewBindingRefusal } from '../../../src/shared/task-workflow/workflow-binding-checks.ts'
import { validateWorkflowNativeOutcome } from './workflow-native-outcome-policy.mjs'
import { hasWorkflowNativeTestEvidence } from './workflow-native-test-evidence.mjs'
import { workflowRoleExecutionForAsset } from './workflow-native-role-execution.mjs'
import { workflowHandoffSummary } from './workflow-case-outcome-consumer.mjs'
import {
  readPlanGraphSource,
  readPlanGraphRows,
  storePlanGraph
} from './workflow-plan-graph-records.mjs'
import { admitPlanGraphTasks } from './workflow-plan-graph-admission.mjs'
import { refuseWorkbench as refuse } from './team-workbench-repository-records.mjs'

export function planOutcomeHandoff(binding, subject, reviewer, stageRef) {
  return {
    contractVersion: 1,
    kind: 'workflow.handoff',
    handoffRef: subject.outcomeRef,
    binding,
    stageRef: subject.proposalTaskRef,
    producer: subject.producer,
    consumer: { stageRef, employeeRef: reviewer.employeeRef, role: 'tester' },
    artifact: subject.reportVersion,
    codeVersion: subject.codeVersion,
    dependencyVersions: [],
    summary: subject.summary,
    audienceScope: {
      scope: binding.scope,
      employeeRefs: [subject.producer.employeeRef, reviewer.employeeRef]
    }
  }
}

export async function consumePlanGraphOutcome(db, accountId, task, receipt, nativeDelivery) {
  if (task.run_scope.kind !== 'workbenchPlan') {
    return
  }
  const source = await readPlanGraphSource(db, accountId, task.run_scope)
  let records = await readPlanGraphRows(db, accountId, source)
  if (receipt.status === 'cancelled') {
    if (records.graph.status === 'cancel_requested' && records.runs.every((run) => run.hasResult)) {
      await storePlanGraph(db, records.graph, 'cancelled')
    } else if (records.graph.status === 'running') {
      await storePlanGraph(db, records.graph, 'paused')
    }
    return
  }
  if (
    !nativeDelivery &&
    receipt.status === 'failed' &&
    receipt.stopProof.evidenceKind === 'not_started'
  ) {
    if (records.graph.status === 'cancel_requested') {
      await db`UPDATE issues SET status='cancelled' WHERE id=${task.id} AND company_id=${task.company_id}`
    }
    await storePlanGraph(
      db,
      records.graph,
      records.graph.status === 'cancel_requested'
        ? records.runs.every((run) => run.hasResult)
          ? 'cancelled'
          : 'cancel_requested'
        : 'paused'
    )
    return
  }
  const { delivery, report, proposal } = validateWorkflowNativeOutcome(
    task,
    receipt,
    nativeDelivery
  )
  const { asset } = delivery,
    producer = workflowRoleExecutionForAsset(asset)
  let valid = receipt.status === 'succeeded' && Boolean(report?.text.trim()),
    review
  if (producer.role === 'developer' && asset.outcome.codeVersion?.kind !== 'snapshot') {
    valid = false
  }
  if (producer.role === 'tester') {
    const context = asset.outcome.context
    const subject = records.outcomes.find(
      (item) =>
        item.producer.role === 'developer' &&
        context.planExecution.dependencyOutcomes.some((dep) => dep.outcomeRef === item.outcomeRef)
    )
    if (
      !subject ||
      !proposal ||
      !report ||
      digest(subject.codeVersion) !== digest(proposal.testedCodeVersion)
    ) {
      valid = false
    } else {
      review = WorkflowReviewSchema.parse({
        contractVersion: 1,
        kind: 'workflow.review',
        reviewRef: `review:${digest(asset.version)}`,
        binding: source.application.binding,
        stageRef: task.run_scope.proposalTaskRef,
        subjectHandoffRef: subject.outcomeRef,
        artifact: subject.reportVersion,
        codeVersion: subject.codeVersion,
        reviewer: producer,
        decision: proposal.decision,
        testReport: report.version
      })
      if (
        workflowReviewBindingRefusal(
          planOutcomeHandoff(
            source.application.binding,
            subject,
            producer,
            task.run_scope.proposalTaskRef
          ),
          review
        )
      ) {
        refuse('REVISION_CONFLICT')
      }
      valid =
        valid &&
        proposal.decision === 'approved' &&
        hasWorkflowNativeTestEvidence(delivery.commands)
    }
  }
  if (report) {
    const outcome = HiveWorkflowPlanGraphOutcomeSchema.parse({
      kind: 'workflow.plan-task-outcome',
      outcomeRef: `plan-outcome:${digest(asset.version)}`,
      graphRef: records.graph.graphRef,
      applicationRef: source.application.applicationRef,
      proposalTaskRef: task.run_scope.proposalTaskRef,
      producer,
      status: receipt.status,
      nativeOutcomeVersion: asset.version,
      reportVersion: report.version,
      summary: workflowHandoffSummary(report.text),
      ...(asset.outcome.codeVersion ? { codeVersion: asset.outcome.codeVersion } : {}),
      ...(review ? { review } : {})
    })
    await db`INSERT INTO hive_workflow_plan_graph_outcomes(run_id,graph_id,outcome_json) VALUES(${task.run_id},${records.graph.graphRef},${db.json(outcome)})`
  } else if (receipt.status === 'succeeded') {
    refuse('REVISION_CONFLICT')
  }
  await db`UPDATE issues SET status=${valid ? 'done' : 'blocked'} WHERE id=${task.id} AND company_id=${task.company_id}`
  if (records.graph.status === 'cancel_requested') {
    if (!valid) {
      await db`UPDATE issues SET status='cancelled' WHERE id=${task.id} AND company_id=${task.company_id}`
    }
    if (records.runs.every((run) => run.hasResult)) {
      await storePlanGraph(db, records.graph, 'cancelled')
    }
    return
  }
  if (!valid) {
    await storePlanGraph(db, records.graph, 'paused')
    return
  }
  records = await readPlanGraphRows(db, accountId, source)
  if (records.graph.status !== 'running') {
    return
  }
  const tasks =
    await db`SELECT id,status FROM issues WHERE id=ANY(${source.application.createdTaskRefs.map((item) => item.taskId)}::uuid[]) FOR SHARE`
  const latestOutcomes = source.application.createdTaskRefs.map((mapping) => {
    const latest = records.runs
      .filter((run) => run.task.taskId === mapping.taskId)
      .sort((a, b) => b.task.attempt - a.task.attempt)[0]
    return latest?.status === 'succeeded'
      ? records.outcomes.find((outcome) => outcome.producer.task.runId === latest.task.runId)
      : undefined
  })
  const allDone =
    tasks.every((item) => item.status === 'done') &&
    latestOutcomes.every((item) => item?.status === 'succeeded')
  if (allDone) {
    const developers = latestOutcomes.filter(
      (item) => item.producer.role === 'developer' && item.status === 'succeeded'
    )
    if (
      developers.some(
        (subject) =>
          latestOutcomes.filter(
            (item) =>
              item.review?.decision === 'approved' &&
              item.review.subjectHandoffRef === subject.outcomeRef &&
              !workflowReviewBindingRefusal(
                planOutcomeHandoff(
                  source.application.binding,
                  subject,
                  item.producer,
                  item.proposalTaskRef
                ),
                item.review
              )
          ).length !== 1
      )
    ) {
      await storePlanGraph(db, records.graph, 'paused')
      return
    }
    await storePlanGraph(db, records.graph, 'done')
    return
  }
  if (
    source.application.createdTaskRefs.some((mapping) => {
      const latest = records.runs
        .filter((run) => run.task.taskId === mapping.taskId)
        .sort((a, b) => b.task.attempt - a.task.attempt)[0]
      return latest?.status === 'failed'
    })
  ) {
    await storePlanGraph(db, records.graph, 'paused')
    return
  }
  try {
    await db.savepoint((transaction) =>
      admitPlanGraphTasks(transaction, accountId, source, records)
    )
  } catch (error) {
    if (!['CAPABILITY_UNAVAILABLE', 'FORBIDDEN', 'REVISION_CONFLICT'].includes(error.code)) {
      throw error
    }
    const target =
      source.draft.inspection.proposal.tasks.find(
        (item) => item.taskRef === error.proposalTaskRef
      ) ??
      source.draft.inspection.proposal.tasks.find(
        (item) => !records.runs.some((run) => run.proposalTaskRef === item.taskRef)
      )
    const reasons = new Set([
      'deadline_exceeded',
      'role_unavailable',
      'project_binding_changed',
      'source_busy',
      'source_case_cancelled',
      'resource_loading_unavailable',
      'knowledge_access_unavailable',
      'hard_budget_unavailable',
      'unsupported_graph',
      'independent_review_required'
    ])
    await storePlanGraph(db, records.graph, 'paused', {
      kind: 'admission_unavailable',
      code: error.code,
      reason: reasons.has(error.reason)
        ? error.reason
        : error.code === 'FORBIDDEN'
          ? 'authorization_unavailable'
          : error.code === 'REVISION_CONFLICT'
            ? 'revision_conflict'
            : 'capability_unavailable',
      proposalTaskRef: target?.taskRef ?? task.run_scope.proposalTaskRef,
      causeRunId: task.run_id
    })
  }
}
