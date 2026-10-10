import { randomUUID } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  HiveWorkflowPlanGraphQuerySchema,
  HiveWorkflowPlanGraphStartSchema,
  HiveWorkflowPlanGraphMutationSchema,
  HiveWorkflowPlanGraphRetrySchema,
  HiveWorkflowPlanRunReadSchema,
  HiveWorkflowPlanGraphReplySchema,
  HiveWorkflowPlanGraphControlSchema
} from '../../../src/shared/hive-workflow-plan-runs.ts'
import {
  readPlanGraphSource,
  readPlanGraphRows,
  planGraphView,
  planRunAdmission,
  storePlanGraph
} from './workflow-plan-graph-records.mjs'
import { admitPlanGraphTasks } from './workflow-plan-graph-admission.mjs'
import { planGraphAvailability } from './workflow-plan-graph-policy.mjs'
import {
  workbenchOwnerReferences,
  refuseWorkbench as refuse
} from './team-workbench-repository-records.mjs'

export function createWorkflowPlanGraphRepository(sql) {
  const mutate = async (accountId, raw, schema, operation, apply) => {
    const input = schema.parse(raw)
    workbenchOwnerReferences(accountId)
    return sql.begin(async (db) => {
      await db`SELECT pg_advisory_xact_lock(hashtextextended(${`hive-workbench:${accountId}`},0))`
      let source = await readPlanGraphSource(db, accountId, input),
        records = await readPlanGraphRows(db, accountId, source)
      const fingerprint = digest({ operation, input })
      const [previous] =
        await db`SELECT * FROM hive_workbench_request_receipts WHERE account_id=${accountId} AND request_id=${input.requestId}`
      if (
        previous &&
        (previous.operation !== operation ||
          previous.payload_fingerprint !== fingerprint ||
          previous.company_id !== source.project.companyId)
      ) {
        refuse('IDEMPOTENCY_CONFLICT')
      }
      if (!previous) {
        await apply(db, accountId, input, source, records)
        source = await readPlanGraphSource(db, accountId, input)
        records = await readPlanGraphRows(db, accountId, source)
      }
      const reply = HiveWorkflowPlanGraphReplySchema.parse({
        admission: {
          requestId: input.requestId,
          payloadFingerprint: fingerprint,
          replayed: Boolean(previous)
        },
        view: await planGraphView(db, accountId, source, records)
      })
      if (!previous) {
        await db`INSERT INTO hive_workbench_request_receipts(account_id,request_id,operation,payload_fingerprint,company_id,response_json) VALUES(${accountId},${input.requestId},${operation},${fingerprint},${source.project.companyId},${db.json(reply)})`
      }
      return reply
    })
  }
  return {
    async getWorkflowPlanGraph(accountId, raw) {
      const query = HiveWorkflowPlanGraphQuerySchema.parse(raw)
      workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        const source = await readPlanGraphSource(db, accountId, query)
        return planGraphView(db, accountId, source, await readPlanGraphRows(db, accountId, source))
      })
    },
    async getWorkflowPlanRunAdmission(accountId, raw) {
      const query = HiveWorkflowPlanRunReadSchema.parse(raw)
      workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        const source = await readPlanGraphSource(db, accountId, query)
        return planRunAdmission(
          source,
          await readPlanGraphRows(db, accountId, source),
          query.taskId,
          query.runId
        )
      })
    },
    startWorkflowPlanGraph: (accountId, input) =>
      mutate(
        accountId,
        input,
        HiveWorkflowPlanGraphStartSchema,
        'plans.graph.start',
        async (db, accountId, input, source, records) => {
          const proposal = source.draft.inspection.proposal
          if (
            records.graph ||
            input.expectedCaseRevision !== source.view.revision ||
            input.expectedProjectRevision !== source.project.binding.bindingRevision ||
            input.draftDigest !== source.application.draftDigest ||
            input.proposalDigest !== source.application.proposalDigest ||
            input.requestedDurationMs > proposal.requestedLimits.maxDurationMs
          ) {
            refuse('REVISION_CONFLICT')
          }
          const reason = await planGraphAvailability(db, accountId, source, null)
          if (reason) {
            throw Object.assign(new Error('CAPABILITY_UNAVAILABLE'), {
              code: 'CAPABILITY_UNAVAILABLE',
              reason
            })
          }
          const [clock] = await db`SELECT clock_timestamp() AS now`
          const graph = HiveWorkflowPlanGraphControlSchema.parse({
            graphRef: randomUUID(),
            applicationRef: source.application.applicationRef,
            requestId: input.requestId,
            binding: source.application.binding,
            planRevision: source.application.planRevision,
            draftDigest: input.draftDigest,
            proposalDigest: input.proposalDigest,
            projectBindingRevision: input.expectedProjectRevision,
            revision: 1,
            status: 'running',
            startedAt: clock.now.toISOString(),
            deadlineAt: new Date(clock.now.getTime() + input.requestedDurationMs).toISOString(),
            maxParallelism: proposal.requestedLimits.maxParallelism,
            maxDurationMs: input.requestedDurationMs,
            retryBackoffMs: 1000
          })
          await db`INSERT INTO hive_workflow_plan_graphs(graph_id,application_id,control_json) VALUES(${graph.graphRef},${graph.applicationRef},${db.json(graph)})`
          await admitPlanGraphTasks(db, accountId, source, { ...records, graph })
        }
      ),
    cancelWorkflowPlanGraph: (accountId, input) =>
      mutate(
        accountId,
        input,
        HiveWorkflowPlanGraphMutationSchema,
        'plans.graph.cancel',
        async (db, accountId, input, source, records) => {
          const graph = records.graph
          if (
            !graph ||
            graph.graphRef !== input.graphRef ||
            graph.revision !== input.expectedGraphRevision ||
            ['done', 'cancelled'].includes(graph.status)
          ) {
            refuse('REVISION_CONFLICT')
          }
          const active = records.runs.filter((run) => !run.hasResult)
          for (const run of active) {
            await db`UPDATE hive_task_bindings SET cancel_requested=true WHERE account_id=${accountId} AND run_id=${run.task.runId}`
            await db`UPDATE heartbeat_runs SET context_snapshot=coalesce(context_snapshot,'{}'::jsonb)||jsonb_build_object('externalExecutionControl',coalesce(context_snapshot->'externalExecutionControl','{}'::jsonb)||jsonb_build_object('cancel',jsonb_build_object('requestedAt',clock_timestamp(),'reason','plan_graph_cancelled'))) WHERE id=${run.task.runId}`
          }
          await db`UPDATE issues SET status='cancelled',status_version=status_version+1 WHERE id=ANY(${source.application.createdTaskRefs.map((item) => item.taskId)}::uuid[]) AND status IN ('backlog','blocked') AND execution_run_id IS NULL AND checkout_run_id IS NULL`
          await storePlanGraph(db, graph, active.length ? 'cancel_requested' : 'cancelled')
        }
      ),
    retryWorkflowPlanTask: (accountId, input) =>
      mutate(
        accountId,
        input,
        HiveWorkflowPlanGraphRetrySchema,
        'plans.graph.retry',
        async (db, accountId, input, source, records) => {
          const graph = records.graph,
            run = records.runs
              .filter((item) => item.task.taskId === input.taskId)
              .sort((a, b) => b.task.attempt - a.task.attempt)[0]
          const row = records.rows.find((item) => item.run_id === run?.task.runId)
          const task = source.taskStates.find((item) => item.taskId === input.taskId)
          if (
            !graph ||
            graph.graphRef !== input.graphRef ||
            graph.revision !== input.expectedGraphRevision ||
            graph.status !== 'paused' ||
            !run ||
            run.task.runId !== input.causeRunId ||
            run.status !== 'failed' ||
            !run.hasResult ||
            task?.taskRevision !== input.expectedTaskRevision ||
            records.runs.some((item) => ['unknown', 'cancelRequested'].includes(item.status)) ||
            records.outcomes.some((item) => item.review && item.review.decision !== 'approved') ||
            row.execution_stage !== 'settled' ||
            !['stopped', 'not_started'].includes(row.result_receipt?.stopProof?.evidenceKind)
          ) {
            refuse('REVISION_CONFLICT')
          }
          const [clock] = await db`SELECT clock_timestamp() AS now`
          if (!row.finished_at || clock.now.getTime() - row.finished_at.getTime() < 1000) {
            refuse('REVISION_CONFLICT')
          }
          const next = await storePlanGraph(db, graph, 'running')
          await admitPlanGraphTasks(
            db,
            accountId,
            source,
            { ...records, graph: next },
            input.taskId
          )
        }
      ),
    resumeWorkflowPlanGraph: (accountId, input) =>
      mutate(
        accountId,
        input,
        HiveWorkflowPlanGraphMutationSchema,
        'plans.graph.resume',
        async (db, accountId, input, source, records) => {
          const graph = records.graph
          const latest = source.application.createdTaskRefs.map(
            (mapping) =>
              records.runs
                .filter((run) => run.task.taskId === mapping.taskId)
                .sort((a, b) => b.task.attempt - a.task.attempt)[0]
          )
          if (
            !graph ||
            graph.graphRef !== input.graphRef ||
            graph.revision !== input.expectedGraphRevision ||
            graph.status !== 'paused' ||
            graph.pauseCause?.kind !== 'admission_unavailable' ||
            latest.some(
              (run) =>
                run && ['failed', 'unknown', 'cancelRequested', 'cancelled'].includes(run.status)
            ) ||
            records.outcomes.some(
              (outcome) => outcome.review && outcome.review.decision !== 'approved'
            ) ||
            !records.outcomes.some(
              (outcome) =>
                outcome.producer.task.runId === graph.pauseCause.causeRunId &&
                outcome.status === 'succeeded'
            )
          ) {
            refuse('REVISION_CONFLICT')
          }
          const next = await storePlanGraph(db, graph, 'running')
          await db.savepoint((transaction) =>
            admitPlanGraphTasks(transaction, accountId, source, { ...records, graph: next })
          )
        }
      )
  }
}
