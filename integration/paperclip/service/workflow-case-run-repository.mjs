import { randomUUID } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  HiveWorkflowCaseStartSchema,
  HiveWorkflowCaseRunAdmissionSchema,
  HiveWorkflowCaseRunsSchema,
  HiveWorkflowCaseRunReadSchema
} from '../../../src/shared/hive-workflow-case-runs.ts'
import { HiveWorkflowCaseReadQuerySchema } from '../../../src/shared/hive-workflow-cases.ts'
import { hiveWorkflowStagePrompt } from '../../../src/shared/hive-workflow-stage-prompt.ts'
import { hiveWorkflowStageContext } from '../../../src/shared/hive-workflow-stage-context.ts'
import {
  refuseWorkbench as refuse,
  workbenchOwnerReferences
} from './team-workbench-repository-records.mjs'
import { requireWorkflowIssueCheckout } from './workflow-issue-checkout.mjs'
import {
  assertCurrentWorkflowEmployees,
  requireLinearWorkflowDefinition
} from './workflow-pipeline-policy.mjs'
import {
  readWorkflowCaseRun,
  requireWorkflowCase,
  WorkflowRunInputSchema
} from './workflow-case-run-records.mjs'

/** Reserves an original fixed stage Issue; the original host and dispatcher still own execution. */
export function createWorkflowCaseRunRepository(sql) {
  return {
    async getWorkflowCaseRunAdmission(accountId, rawQuery) {
      const query = HiveWorkflowCaseRunReadSchema.parse(rawQuery)
      workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        const record = await readWorkflowCaseRun(db, accountId, query.taskId, query.runId)
        if (
          record.run.caseId !== query.caseId ||
          record.run.startRequest.projectId !== query.projectId
        ) {
          refuse('FORBIDDEN')
        }
        return HiveWorkflowCaseRunAdmissionSchema.parse({
          requestId: record.requestId,
          payloadFingerprint: record.payloadFingerprint,
          replayed: true,
          run: record.run,
          definitionDigest: record.input.definitionDigest,
          projectBindingRevision: record.input.projectBindingRevision,
          input: record.input.input,
          inputDigest: record.input.inputDigest,
          workspaceSelector: record.input.workspaceSelector,
          executionDeadlineAt: record.input.executionDeadlineAt,
          workflowContext: record.input.workflowContext
        })
      })
    },
    async startWorkflowCase(accountId, rawInput) {
      const input = HiveWorkflowCaseStartSchema.parse(rawInput)
      const owner = workbenchOwnerReferences(accountId)
      const payloadFingerprint = digest({ operation: 'cases.start', input })
      return sql.begin(async (db) => {
        await db`SELECT pg_advisory_xact_lock(hashtextextended(${`hive-workbench:${accountId}`},0))`
        const { project, view } = await requireWorkflowCase(db, accountId, input, true)
        requireLinearWorkflowDefinition(view.workflow.definition)
        await assertCurrentWorkflowEmployees(
          db,
          view.workflow.definition.scope,
          view.team.employees
        )
        const [previous] = await db`SELECT task_id,run_id,input_fingerprint FROM hive_task_bindings
          WHERE account_id=${accountId} AND request_id=${input.requestId}`
        const reply = async (taskId, runId, replayed) => {
          const record = await readWorkflowCaseRun(db, accountId, taskId, runId)
          if (
            record.run.caseId !== input.caseId ||
            record.run.stageRef !== input.stageRef ||
            record.payloadFingerprint !== payloadFingerprint ||
            record.requestId !== input.requestId
          ) {
            refuse('IDEMPOTENCY_CONFLICT')
          }
          return HiveWorkflowCaseRunAdmissionSchema.parse({
            requestId: input.requestId,
            payloadFingerprint,
            replayed,
            run: record.run,
            definitionDigest: record.input.definitionDigest,
            projectBindingRevision: record.input.projectBindingRevision,
            input: record.input.input,
            inputDigest: record.input.inputDigest,
            workspaceSelector: record.input.workspaceSelector,
            executionDeadlineAt: record.input.executionDeadlineAt,
            workflowContext: record.input.workflowContext
          })
        }
        if (previous) {
          if (previous.input_fingerprint !== payloadFingerprint) {
            refuse('IDEMPOTENCY_CONFLICT')
          }
          return reply(previous.task_id, previous.run_id, true)
        }
        const stage = view.workflow.definition.stages.find(
          (candidate) => candidate.stageRef === input.stageRef
        )
        const fixed = view.stageTasks.find((candidate) => candidate.stageRef === input.stageRef)
        if (
          view.revision !== input.expectedCaseRevision ||
          view.terminalKind !== null ||
          view.currentStageRef !== input.stageRef ||
          !stage ||
          !fixed ||
          fixed.taskRevision !== input.expectedTaskRevision ||
          stage.role !== 'product' ||
          stage.dependsOn.length !== 0 ||
          fixed.status !== 'backlog'
        ) {
          refuse('REVISION_CONFLICT')
        }
        const [business] = await db`SELECT *,lease_expires_at>clock_timestamp() AS lease_live
          FROM pipeline_cases WHERE id=${view.id} FOR UPDATE`
        if (
          business.lease_live &&
          !(business.lease_owner_type === 'user' && business.lease_user_id === owner.actorRef)
        ) {
          refuse('REVISION_CONFLICT')
        }
        const [task] = await db`SELECT i.*,${fixed.employeeRef}::uuid AS agent_id
          FROM issues i WHERE id=${fixed.taskId} AND company_id=${project.companyId} FOR UPDATE`
        if (
          !task ||
          task.assignee_agent_id !== fixed.employeeRef ||
          task.checkout_run_id !== null ||
          task.execution_run_id !== null ||
          Number(task.status_version) !== fixed.taskRevision ||
          Number(task.status_version) > 2_147_483_644
        ) {
          refuse('REVISION_CONFLICT')
        }
        const prior = await db`SELECT run_id FROM hive_task_bindings
          WHERE task_id=${task.id} AND account_id=${accountId} LIMIT 1`
        if (prior.length) {
          refuse('REVISION_CONFLICT')
        }
        const runId = randomUUID()
        await requireWorkflowIssueCheckout(db, task, runId)
        const prompt = hiveWorkflowStagePrompt(view, stage.stageRef)
        const [clock] = await db`SELECT clock_timestamp() AS admitted_at`
        const executionDeadlineAt = new Date(
          clock.admitted_at.getTime() + view.workflow.definition.maxDurationMs
        ).toISOString()
        const taskRef = {
          spaceId: project.companyId,
          taskId: task.id,
          runId,
          attempt: 1,
          taskRevision: String(fixed.taskRevision + 1)
        }
        const intent = WorkflowRunInputSchema.parse({
          caseId: view.id,
          stageRef: stage.stageRef,
          task: taskRef,
          startRequest: input,
          definitionDigest: view.definitionDigest,
          projectBindingRevision: view.projectBindingRevision,
          input: prompt,
          inputDigest: digest(prompt),
          workspaceSelector: project.workspaceSelector,
          executionDeadlineAt,
          workflowContext: hiveWorkflowStageContext(view, stage.stageRef)
        })
        await db`INSERT INTO heartbeat_runs(id,company_id,agent_id,status,invocation_source,driver_kind)
          VALUES(${runId},${project.companyId},${fixed.employeeRef},'queued','on_demand','hive_runtime')`
        const updated = await db`UPDATE issues SET status='todo',status_version=status_version+1,
          execution_run_id=${runId},updated_at=now() WHERE id=${task.id} AND company_id=${project.companyId}
          AND status_version=${fixed.taskRevision} AND status='backlog' AND assignee_agent_id=${fixed.employeeRef}
          AND checkout_run_id IS NULL AND execution_run_id IS NULL RETURNING id`
        if (updated.length !== 1) {
          refuse('REVISION_CONFLICT')
        }
        await db`INSERT INTO hive_task_bindings(task_id,account_id,run_id,request_id,input_fingerprint,workspace_selector,workflow_input)
          VALUES(${task.id},${accountId},${runId},${input.requestId},${payloadFingerprint},${project.workspaceSelector},${db.json(intent)})`
        // Execution bookkeeping must preserve the review version and the unresolved-drift timestamp boundary.
        const changed = await db`SELECT id FROM pipeline_cases
          WHERE id=${view.id} AND company_id=${project.companyId} AND version=${input.expectedCaseRevision}
            AND stage_id=${business.stage_id} AND terminal_kind IS NULL FOR UPDATE`
        if (changed.length !== 1) {
          refuse('REVISION_CONFLICT')
        }
        const details = {
          kind: 'hive.workflow.run_admitted',
          stageRef: stage.stageRef,
          taskId: task.id,
          runId,
          employeeRef: fixed.employeeRef,
          workflowRevision: view.binding.workflowRevision,
          definitionDigest: view.definitionDigest
        }
        await db`INSERT INTO pipeline_case_events(company_id,case_id,type,actor_type,actor_user_id,run_id,payload)
          VALUES(${project.companyId},${view.id},'updated','user',${owner.actorRef},${runId},${db.json(details)})`
        await db`INSERT INTO activity_log(company_id,actor_type,actor_id,action,entity_type,entity_id,responsible_user_id,details)
          VALUES(${project.companyId},'user',${owner.actorRef},'hive.workflow.run_admitted','pipeline_case',${view.id},${owner.actorRef},${db.json(details)})`
        return reply(task.id, runId, false)
      })
    },
    async getWorkflowCaseRuns(accountId, rawQuery) {
      const query = HiveWorkflowCaseReadQuerySchema.parse(rawQuery)
      workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        const { view } = await requireWorkflowCase(db, accountId, query)
        const rows = await db`SELECT b.task_id,b.run_id FROM hive_task_bindings b
          JOIN hive_workflow_case_stage_issues s ON s.issue_id=b.task_id
          WHERE b.account_id=${accountId} AND s.case_id=${view.id} ORDER BY b.run_id LIMIT 97`
        if (rows.length > 96) {
          refuse('REVISION_CONFLICT')
        }
        const runs = []
        for (const row of rows) {
          runs.push((await readWorkflowCaseRun(db, accountId, row.task_id, row.run_id)).run)
        }
        return HiveWorkflowCaseRunsSchema.parse(runs)
      })
    }
  }
}
