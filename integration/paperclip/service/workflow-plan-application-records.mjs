import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  HiveWorkflowPlanApplySchema,
  HiveWorkflowPlanApplicationReceiptSchema,
  HiveWorkflowPlanApplicationViewSchema
} from '../../../src/shared/hive-workflow-plan-application.ts'
import { compareWorkflowPlans } from '../../../src/shared/task-workflow/workflow-plan-diff.ts'
import { WorkflowPlanDraftSchema } from '../../../src/shared/task-workflow/workflow-plan-draft.ts'
import { workflowPlanApplicationMatchesDraft } from '../../../src/shared/hive-workflow-plan-application-source.ts'
import {
  requireWorkbenchProject,
  readWorkbenchTeam,
  refuseWorkbench as refuse
} from './team-workbench-repository-records.mjs'
import { readWorkflowCaseView } from './workflow-case-records.mjs'
import { readWorkflowDefinitionRevision } from './workflow-definition-repository.mjs'

export async function readPlanSource(db, accountId, query, write = false) {
  if (write) {
    // Company numbering precedes project locks, matching company-first readers.
    const [company] = await db`SELECT c.id FROM companies c
      JOIN hive_workbench_company_bindings cb ON cb.company_id=c.id
      JOIN projects p ON p.company_id=c.id
      WHERE p.id=${query.projectId} AND cb.account_id=${accountId} FOR UPDATE OF c FOR SHARE OF cb`
    if (!company) {
      refuse('FORBIDDEN')
    }
  }
  const { project } = await requireWorkbenchProject(db, accountId, query.projectId, write)
  const [binding] =
    await db`SELECT case_id,workflow_id,workflow_revision,project_binding_revision FROM hive_workflow_case_bindings
    WHERE case_id=${query.caseId} AND account_id=${accountId}
      AND project_id=${project.id} AND company_id=${project.companyId} FOR SHARE`
  if (!binding) {
    refuse('FORBIDDEN')
  }
  // Canonical readers acquire the immutable pipeline before any Case lock.
  await readWorkflowDefinitionRevision(
    db,
    project,
    binding.workflow_id,
    Number(binding.workflow_revision),
    Number(binding.project_binding_revision)
  )
  await db`SELECT id FROM pipeline_cases WHERE id=${binding.case_id} AND company_id=${project.companyId} FOR UPDATE`
  const view = await readWorkflowCaseView(db, accountId, project, binding.case_id)
  const draft = view.planDrafts.find((item) => item.draftRef === query.draftRef)
  if (!draft) {
    refuse('REVISION_CONFLICT')
  }
  return { project, view, draft }
}

export async function readPlanApplication(db, accountId, source) {
  const { view, project } = source
  const [row] =
    await db`SELECT * FROM hive_workflow_plan_applications WHERE case_id=${view.id} FOR SHARE`
  if (!row) {
    return { application: null, taskStates: [] }
  }
  const parsed = HiveWorkflowPlanApplicationReceiptSchema.safeParse(row.receipt_json)
  if (!parsed.success) {
    refuse('REVISION_CONFLICT')
  }
  const application = parsed.data
  const original = HiveWorkflowPlanApplySchema.safeParse(row.apply_input_json)
  const [producer] = await db`SELECT result_receipt FROM hive_task_bindings
    WHERE run_id=${row.source_run_id} AND account_id=${accountId} FOR SHARE`
  const [request] =
    await db`SELECT operation,payload_fingerprint,response_json,company_id FROM hive_workbench_request_receipts
    WHERE account_id=${accountId} AND request_id=${application.requestId} FOR SHARE`
  const draft = WorkflowPlanDraftSchema.parse(row.draft_json)
  const published = view.planDrafts.find((item) => item.draftRef === application.draftRef)
  if (
    producer?.result_receipt?.status !== 'succeeded' ||
    !original.success ||
    !request ||
    request.operation !== 'plans.apply' ||
    request.company_id !== project.companyId ||
    request.payload_fingerprint !== digest({ operation: 'plans.apply', input: original.data }) ||
    digest(request.response_json) !== digest(application) ||
    original.data.caseId !== view.id ||
    original.data.projectId !== project.id ||
    original.data.requestId !== application.requestId ||
    original.data.draftRef !== application.draftRef ||
    original.data.draftDigest !== application.draftDigest ||
    original.data.planRevision !== application.planRevision ||
    original.data.expectedProjectRevision !== application.projectBindingRevision ||
    !published ||
    digest(published.intent) !== digest(draft.intent) ||
    !workflowPlanApplicationMatchesDraft(application, draft) ||
    draft.inspection.kind !== 'validated' ||
    row.account_id !== accountId ||
    row.company_id !== project.companyId ||
    row.application_id !== application.applicationRef ||
    row.source_run_id !== draft.intent.sourceTask.runId ||
    row.receipt_digest !== digest(application) ||
    row.draft_digest !== digest(draft) ||
    digest(row.draft_json) !== digest(draft) ||
    application.draftDigest !== digest(draft) ||
    application.proposalDigest !== digest(draft.inspection.proposal) ||
    application.planRevision !== draft.intent.facts.planRevision ||
    application.projectBindingRevision !== view.projectBindingRevision ||
    digest(application.binding) !== digest(view.binding) ||
    application.parentTaskRef !== view.originTaskId
  ) {
    refuse('REVISION_CONFLICT')
  }
  const mappings =
    await db`SELECT m.*,i.project_id,i.parent_id,i.assignee_agent_id,i.assignee_user_id,
    i.company_id AS issue_company_id,i.status,i.status_version FROM hive_workflow_plan_application_tasks m
    JOIN issues i ON i.id=m.issue_id WHERE m.application_id=${application.applicationRef} LIMIT 33 FOR SHARE OF m,i`
  const proposals = draft.inspection.proposal.tasks
  if (
    mappings.length !== proposals.length ||
    application.createdTaskRefs.length !== proposals.length
  ) {
    refuse('REVISION_CONFLICT')
  }
  for (const proposal of proposals) {
    const mapping = mappings.find((item) => item.proposal_task_ref === proposal.taskRef)
    const receipt = application.createdTaskRefs.find(
      (item) => item.proposalTaskRef === proposal.taskRef
    )
    const employee = view.team.employees.find((item) => item.role === proposal.requestedRole)
    const dependencies = proposal.dependsOn
      .map(
        (ref) => application.createdTaskRefs.find((item) => item.proposalTaskRef === ref)?.taskId
      )
      .sort()
    if (
      !mapping ||
      !receipt ||
      !employee ||
      mapping.issue_id !== receipt.taskId ||
      mapping.company_id !== project.companyId ||
      mapping.issue_company_id !== project.companyId ||
      mapping.project_id !== project.id ||
      mapping.parent_id !== view.originTaskId ||
      mapping.employee_id !== employee.employeeRef ||
      receipt.employeeRef !== employee.employeeRef ||
      mapping.assignee_agent_id !== employee.employeeRef ||
      mapping.assignee_user_id !== null ||
      digest([...receipt.dependsOnTaskIds].sort()) !== digest(dependencies)
    ) {
      refuse('REVISION_CONFLICT')
    }
  }
  const ids = application.createdTaskRefs.map((item) => item.taskId)
  const relations = await db`SELECT company_id,issue_id,related_issue_id,type FROM issue_relations
    WHERE issue_id=ANY(${ids}::uuid[]) OR related_issue_id=ANY(${ids}::uuid[]) LIMIT 1025 FOR SHARE`
  const actual = relations
    .map((item) => `${item.company_id}:${item.type}:${item.issue_id}:${item.related_issue_id}`)
    .sort()
  const expected = application.createdTaskRefs
    .flatMap((item) =>
      item.dependsOnTaskIds.map((id) => `${project.companyId}:blocks:${id}:${item.taskId}`)
    )
    .sort()
  if (digest(actual) !== digest(expected)) {
    refuse('REVISION_CONFLICT')
  }
  return {
    application,
    originalDraft: draft,
    taskStates: application.createdTaskRefs.map((item) => {
      const row = mappings.find((mapping) => mapping.issue_id === item.taskId)
      return { taskId: item.taskId, status: row.status, taskRevision: Number(row.status_version) }
    })
  }
}

async function eligibility(db, accountId, source, application) {
  const { project, view, draft } = source
  if (application) {
    return application.draftRef === draft.draftRef
      ? 'already_applied'
      : 'plan_replacement_unavailable'
  }
  if (draft.inspection.kind !== 'validated') {
    return draft.inspection.kind === 'rejected' ? 'draft_rejected' : 'draft_unavailable'
  }
  if (digest(view.planningIntent ?? {}) !== digest(draft.intent)) {
    return 'plan_not_current'
  }
  const [producer] = await db`SELECT result_receipt FROM hive_task_bindings
    WHERE run_id=${draft.intent.sourceTask.runId} AND account_id=${accountId} FOR SHARE`
  if (producer?.result_receipt?.status !== 'succeeded') {
    return 'draft_unavailable'
  }
  if (view.terminalKind === 'cancelled') {
    return 'case_cancelled'
  }
  if (
    project.binding.bindingRevision !== view.projectBindingRevision ||
    digest(project.binding) !== digest(view.team.project)
  ) {
    return 'project_binding_changed'
  }
  const team = await readWorkbenchTeam(db, accountId, project.id)
  if (
    digest(team.company.binding) !== digest(view.team.company) ||
    digest(
      team.employees.map((item) => item.binding).sort((a, b) => a.role.localeCompare(b.role))
    ) !== digest([...view.team.employees].sort((a, b) => a.role.localeCompare(b.role)))
  ) {
    return 'role_unavailable'
  }
  const [company] = await db`SELECT status FROM companies WHERE id=${project.companyId} FOR SHARE`
  const agents = await db`SELECT id,status FROM agents WHERE company_id=${project.companyId}
    AND id=ANY(${view.team.employees.map((item) => item.employeeRef)}::uuid[]) FOR SHARE`
  if (
    company?.status !== 'active' ||
    agents.length !== 4 ||
    agents.some((item) => !['idle', 'running', 'error'].includes(item.status))
  ) {
    return 'role_unavailable'
  }
  const sourceIds = [view.originTaskId, ...view.stageTasks.map((item) => item.taskId)]
  const occupied = await db`SELECT id FROM issues WHERE id=ANY(${sourceIds}::uuid[])
    AND (checkout_run_id IS NOT NULL OR execution_run_id IS NOT NULL OR execution_locked_at IS NOT NULL) LIMIT 1 FOR SHARE`
  const active =
    await db`SELECT b.run_id FROM hive_task_bindings b JOIN heartbeat_runs h ON h.id=b.run_id
    WHERE b.task_id=ANY(${sourceIds}::uuid[]) AND b.account_id=${accountId}
      AND (b.cancel_requested OR h.status IN ('queued','running') OR h.execution_stage IS DISTINCT FROM 'settled')
    LIMIT 1 FOR SHARE OF b,h`
  return active.length || occupied.length ? 'case_busy' : null
}

export async function planApplicationView(db, accountId, source, record) {
  const { view, project, draft } = source
  const baseline =
    view.planDrafts
      .filter(
        (item) =>
          item.inspection.kind === 'validated' &&
          item.intent.facts.planRevision < draft.intent.facts.planRevision
      )
      .sort((a, b) => b.intent.facts.planRevision - a.intent.facts.planRevision)[0] ?? null
  const reason = await eligibility(db, accountId, source, record.application)
  return HiveWorkflowPlanApplicationViewSchema.parse({
    caseId: view.id,
    projectId: project.id,
    caseRevision: view.revision,
    currentProjectBindingRevision: project.binding.bindingRevision,
    draft,
    baseline,
    diff:
      draft.inspection.kind === 'validated'
        ? compareWorkflowPlans(draft.inspection.proposal, baseline?.inspection.proposal ?? null)
        : null,
    eligibility: reason ? { available: false, reason } : { available: true },
    application: record.application,
    taskStates: record.taskStates
  })
}
