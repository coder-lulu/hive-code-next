import { randomUUID } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  hiveWorkflowPlanGraphContext,
  hiveWorkflowPlanGraphPrompt
} from '../../../src/shared/hive-workflow-plan-graph-context.ts'
import { requireWorkflowIssueCheckout } from './workflow-issue-checkout.mjs'
import {
  PlanRunInputSchema,
  readPlanGraphRows,
  planGraphView
} from './workflow-plan-graph-records.mjs'
import { planGraphAvailability } from './workflow-plan-graph-policy.mjs'
import { refuseWorkbench as refuse } from './team-workbench-repository-records.mjs'

export async function admitPlanGraphTasks(db, accountId, source, records, retryTaskId) {
  const reason = await planGraphAvailability(db, accountId, source, records.graph)
  if (reason) {
    throw Object.assign(new Error('CAPABILITY_UNAVAILABLE'), {
      code: 'CAPABILITY_UNAVAILABLE',
      reason
    })
  }
  if (records.graph.status !== 'running') {
    refuse('REVISION_CONFLICT')
  }
  let slots = records.graph.maxParallelism - records.runs.filter((item) => !item.hasResult).length
  if (retryTaskId && slots <= 0) {
    refuse('OUTCOME_UNKNOWN')
  }
  const graphView = await planGraphView(db, accountId, source, records)
  for (const proposed of source.draft.inspection.proposal.tasks) {
    if (slots <= 0) {
      break
    }
    const mapped = source.application.createdTaskRefs.find(
      (item) => item.proposalTaskRef === proposed.taskRef
    )
    const prior = records.runs
      .filter((item) => item.task.taskId === mapped.taskId)
      .sort((a, b) => a.task.attempt - b.task.attempt)
    if (retryTaskId ? mapped.taskId !== retryTaskId : prior.length) {
      continue
    }
    if (prior.length >= proposed.maxAttempts || prior.some((item) => !item.hasResult)) {
      refuse('OUTCOME_UNKNOWN')
    }
    if (
      !proposed.dependsOn.every((ref) => {
        const outcomes = records.outcomes
          .filter((item) => item.proposalTaskRef === ref)
          .sort((a, b) => b.producer.task.attempt - a.producer.task.attempt)
        return (
          outcomes[0]?.status === 'succeeded' &&
          (!outcomes[0].review || outcomes[0].review.decision === 'approved')
        )
      })
    ) {
      continue
    }
    try {
      const [task] =
        await db`SELECT *,${mapped.employeeRef}::uuid AS agent_id FROM issues WHERE id=${mapped.taskId} AND company_id=${source.project.companyId} FOR UPDATE`
      if (
        !task ||
        task.assignee_agent_id !== mapped.employeeRef ||
        task.assignee_user_id !== null ||
        task.checkout_run_id ||
        task.execution_run_id ||
        task.execution_locked_at ||
        !['backlog', 'blocked'].includes(task.status) ||
        Number(task.status_version) > 2147483644
      ) {
        refuse('REVISION_CONFLICT')
      }
      const runId = randomUUID(),
        requestId = randomUUID(),
        revision = Number(task.status_version)
      await requireWorkflowIssueCheckout(db, task, runId)
      const taskRef = {
        spaceId: source.project.companyId,
        taskId: task.id,
        runId,
        attempt: prior.length + 1,
        taskRevision: String(revision + 1)
      }
      const startRequest = {
        requestId,
        graphRef: records.graph.graphRef,
        applicationRef: source.application.applicationRef,
        projectId: source.project.id,
        caseId: source.view.id,
        proposalTaskRef: proposed.taskRef,
        expectedTaskRevision: revision,
        attempt: taskRef.attempt
      }
      const workflowContext = hiveWorkflowPlanGraphContext(
        source.view,
        graphView,
        proposed.taskRef,
        taskRef
      )
      const input = hiveWorkflowPlanGraphPrompt(
        source.view,
        graphView,
        proposed.taskRef,
        workflowContext
      )
      const intent = PlanRunInputSchema.parse({
        graphRef: records.graph.graphRef,
        applicationRef: source.application.applicationRef,
        caseId: source.view.id,
        stageRef: proposed.taskRef,
        task: taskRef,
        startRequest,
        definitionDigest: source.view.definitionDigest,
        projectBindingRevision: source.view.projectBindingRevision,
        input,
        inputDigest: digest(input),
        workspaceSelector: source.project.workspaceSelector,
        executionDeadlineAt: records.graph.deadlineAt,
        workflowContext
      })
      await db`INSERT INTO heartbeat_runs(id,company_id,agent_id,status,invocation_source,driver_kind) VALUES(${runId},${source.project.companyId},${mapped.employeeRef},'queued','on_demand','hive_runtime')`
      await db`UPDATE issues SET status='todo',status_version=status_version+1,execution_run_id=${runId},updated_at=now() WHERE id=${task.id}`
      await db`INSERT INTO hive_task_bindings(task_id,account_id,run_id,request_id,input_fingerprint,workspace_selector,workflow_input) VALUES(${task.id},${accountId},${runId},${requestId},${digest({ operation: 'plans.run.start', input: startRequest })},${source.project.workspaceSelector},${db.json(intent)})`
      slots--
    } catch (error) {
      if (error && typeof error === 'object') {
        error.proposalTaskRef = proposed.taskRef
      }
      throw error
    }
  }
  return readPlanGraphRows(db, accountId, source)
}
