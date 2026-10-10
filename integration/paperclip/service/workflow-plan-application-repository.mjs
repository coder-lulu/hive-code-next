import { randomUUID } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  HiveWorkflowPlanQuerySchema,
  HiveWorkflowPlanApplySchema,
  HiveWorkflowPlanApplicationReceiptSchema,
  HiveWorkflowPlanApplyReplySchema
} from '../../../src/shared/hive-workflow-plan-application.ts'
import {
  workbenchOwnerReferences,
  refuseWorkbench as refuse
} from './team-workbench-repository-records.mjs'
import { replayWorkbenchRequest, recordWorkbenchRequest } from './team-workbench-repository.mjs'
import {
  readPlanSource,
  readPlanApplication,
  planApplicationView
} from './workflow-plan-application-records.mjs'

const operation = 'plans.apply'

async function materialize(db, accountId, input, source) {
  const { project, view, draft } = source
  const proposal = draft.inspection.proposal
  const owner = workbenchOwnerReferences(accountId)
  const ids = new Map(proposal.tasks.map((task) => [task.taskRef, randomUUID()]))
  const [counter] =
    await db`UPDATE companies SET issue_counter=issue_counter+${proposal.tasks.length},updated_at=now()
    WHERE id=${project.companyId} AND issue_counter<=${2_147_483_647 - proposal.tasks.length}
    RETURNING issue_counter,issue_prefix`
  if (!counter) {
    refuse('REVISION_CONFLICT')
  }
  const [clock] = await db`SELECT clock_timestamp() AS now`
  const receipt = HiveWorkflowPlanApplicationReceiptSchema.parse({
    contractVersion: 1,
    kind: 'workflow.plan-application',
    applicationRef: randomUUID(),
    requestId: input.requestId,
    binding: view.binding,
    planRevision: input.planRevision,
    draftRef: draft.draftRef,
    draftDigest: digest(draft),
    proposalDigest: digest(proposal),
    projectBindingRevision: view.projectBindingRevision,
    parentTaskRef: view.originTaskId,
    createdTaskRefs: proposal.tasks.map((task) => ({
      proposalTaskRef: task.taskRef,
      taskId: ids.get(task.taskRef),
      employeeRef: view.team.employees.find((employee) => employee.role === task.requestedRole)
        .employeeRef,
      dependsOnTaskIds: task.dependsOn.map((ref) => ids.get(ref))
    })),
    appliedAt: clock.now.toISOString(),
    dispatch: { available: false, reason: 'task_graph_dispatch_unavailable' }
  })
  await db`INSERT INTO hive_workflow_plan_applications
    (application_id,case_id,company_id,account_id,source_run_id,apply_input_json,draft_json,draft_digest,receipt_json,receipt_digest)
    VALUES(${receipt.applicationRef},${view.id},${project.companyId},${accountId},${draft.intent.sourceTask.runId},
      ${db.json(input)},${db.json(draft)},${digest(draft)},${db.json(receipt)},${digest(receipt)})`
  for (const [index, task] of proposal.tasks.entries()) {
    const mapped = receipt.createdTaskRefs[index]
    const number = counter.issue_counter - proposal.tasks.length + index + 1
    await db`INSERT INTO issues(id,company_id,project_id,parent_id,title,description,status,assignee_agent_id,
      created_by_user_id,responsible_user_id,issue_number,identifier)
      VALUES(${mapped.taskId},${project.companyId},${project.id},${view.originTaskId},${task.title},
        ${`Acceptance criteria:\n${task.acceptance.join('\n')}\n\nTask graph dispatch is unavailable.`},'blocked',${mapped.employeeRef},
        ${owner.actorRef},${owner.actorRef},${number},${`${counter.issue_prefix}-${number}`})`
    await db`INSERT INTO hive_workflow_plan_application_tasks(application_id,proposal_task_ref,company_id,issue_id,employee_id)
      VALUES(${receipt.applicationRef},${task.taskRef},${project.companyId},${mapped.taskId},${mapped.employeeRef})`
  }
  for (const task of receipt.createdTaskRefs) {
    for (const dependency of task.dependsOnTaskIds) {
      await db`INSERT INTO issue_relations(company_id,issue_id,related_issue_id,type,created_by_user_id)
        VALUES(${project.companyId},${dependency},${task.taskId},'blocks',${owner.actorRef})`
    }
  }
  return receipt
}

/** The caller supplies the transaction; adoption never admits an execution or reopens its Case. */
export async function applyWorkflowPlanInTransaction(db, accountId, rawInput) {
  if (typeof db.begin === 'function') {
    refuse('REVISION_CONFLICT')
  }
  const input = HiveWorkflowPlanApplySchema.parse(rawInput)
  workbenchOwnerReferences(accountId)
  await db`SELECT pg_advisory_xact_lock(hashtextextended(${`hive-workbench:${accountId}`},0))`
  const source = await readPlanSource(db, accountId, input, true)
  const replay = await replayWorkbenchRequest(
    db,
    accountId,
    input,
    operation,
    HiveWorkflowPlanApplicationReceiptSchema
  )
  let record = await readPlanApplication(db, accountId, source)
  const reply = async (replayed) =>
    HiveWorkflowPlanApplyReplySchema.parse({
      admission: {
        requestId: input.requestId,
        payloadFingerprint: digest({ operation, input }),
        replayed
      },
      view: await planApplicationView(db, accountId, source, record)
    })
  if (replay) {
    if (
      !record.application ||
      digest(replay) !== digest(record.application) ||
      replay.draftRef !== input.draftRef ||
      replay.draftDigest !== input.draftDigest ||
      replay.planRevision !== input.planRevision ||
      replay.projectBindingRevision !== input.expectedProjectRevision
    ) {
      refuse('REVISION_CONFLICT')
    }
    return reply(true)
  }
  if (
    input.draftDigest !== digest(source.draft) ||
    input.planRevision !== source.draft.intent.facts.planRevision
  ) {
    refuse('REVISION_CONFLICT')
  }
  if (record.application) {
    if (
      record.application.draftRef !== input.draftRef ||
      record.application.draftDigest !== input.draftDigest ||
      record.application.projectBindingRevision !== input.expectedProjectRevision
    ) {
      refuse('REVISION_CONFLICT')
    }
    await recordWorkbenchRequest(
      db,
      accountId,
      input,
      operation,
      source.project.companyId,
      record.application
    )
    return reply(true)
  }
  if (
    input.expectedCaseRevision !== source.view.revision ||
    input.expectedProjectRevision !== source.project.binding.bindingRevision
  ) {
    refuse('REVISION_CONFLICT')
  }
  const projected = await planApplicationView(db, accountId, source, record)
  if (!projected.eligibility.available) {
    refuse('REVISION_CONFLICT')
  }
  const receipt = await materialize(db, accountId, input, source)
  await recordWorkbenchRequest(db, accountId, input, operation, source.project.companyId, receipt)
  record = await readPlanApplication(db, accountId, source)
  return reply(false)
}

export function createWorkflowPlanApplicationRepository(sql) {
  return {
    async getWorkflowPlanApplication(accountId, rawQuery) {
      const query = HiveWorkflowPlanQuerySchema.parse(rawQuery)
      workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        await db`SELECT pg_advisory_xact_lock(hashtextextended(${`hive-workbench:${accountId}`},0))`
        const source = await readPlanSource(db, accountId, query)
        return planApplicationView(
          db,
          accountId,
          source,
          await readPlanApplication(db, accountId, source)
        )
      })
    },
    applyWorkflowPlan(accountId, input) {
      return sql.begin((db) => applyWorkflowPlanInTransaction(db, accountId, input))
    }
  }
}
