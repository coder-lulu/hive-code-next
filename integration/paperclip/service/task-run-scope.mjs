import { z } from 'zod'
import { validateWorkflowTaskCase } from './task-run-case-scope.mjs'
import { readWorkflowDefinitionRevision } from './workflow-definition-repository.mjs'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { HiveRuntimeAdapterBinding } from '../../../src/main/tasks/paperclip-adapter-contract.ts'
import {
  requireTaskRepositoryScope,
  refuseTaskRepository as refuse
} from './task-delivery-repository.mjs'
import {
  WORKBENCH_UPSTREAM_ROLES,
  requireWorkbenchProject
} from './team-workbench-repository-records.mjs'

function requireMatching(condition, code = 'REVISION_CONFLICT') {
  if (!condition) {
    refuse(code)
  }
}

function stored(schema, value) {
  const parsed = schema.safeParse(value)
  requireMatching(parsed.success)
  return parsed.data
}

function validateBinding(task, scope, team) {
  if (task.binding === null) {
    return
  }
  const binding = stored(HiveRuntimeAdapterBinding, task.binding)
  const command = binding.command
  requireMatching(
    binding.paperclipCompanyId === task.company_id &&
      binding.paperclipAgentId === task.agent_id &&
      command.task.taskId === task.id &&
      command.task.runId === task.run_id &&
      command.task.spaceId === task.company_id &&
      command.profileId === scope.profileId &&
      command.profileRevision === scope.profileRevision &&
      command.workspaceRef === scope.workspaceRef &&
      command.executionPolicy.trustMode === 'enforced_autonomous' &&
      digest(command.ownerScope) === digest(team.company.ownerScope)
  )
}

/** Admission validates full revisions; immutable revision triggers preserve that proof. No grants are cached. */
export function createTaskRunScopeReader(sql) {
  const readInTransaction = async (db, accountId, taskId, runId, lock) => {
    requireTaskRepositoryScope(accountId, taskId, runId)
    const [candidate] =
      await db`SELECT r.case_id,cb.project_id,cb.company_id,cb.account_id AS case_account_id,
      cb.workflow_id,cb.workflow_revision,cb.project_binding_revision
      FROM hive_task_bindings b JOIN issues i ON i.id=b.task_id
      LEFT JOIN hive_workflow_case_stage_issues r ON r.issue_id=i.id
      LEFT JOIN hive_workflow_case_bindings cb ON cb.case_id=r.case_id
      WHERE b.account_id=${accountId} AND i.id=${taskId} AND b.run_id=${runId}`
    requireMatching(Boolean(candidate), 'FORBIDDEN')
    if (candidate.case_id !== null) {
      requireMatching(candidate.case_account_id === accountId, 'FORBIDDEN')
      const { project } = await requireWorkbenchProject(db, accountId, candidate.project_id)
      requireMatching(project.companyId === candidate.company_id, 'FORBIDDEN')
      await readWorkflowDefinitionRevision(
        db,
        project,
        candidate.workflow_id,
        Number(candidate.workflow_revision),
        Number(candidate.project_binding_revision)
      )
    }
    if (lock) {
      const locked = await db`SELECT i.id FROM issues i JOIN hive_task_bindings b ON b.task_id=i.id
        WHERE b.account_id=${accountId} AND i.id=${taskId} AND b.run_id=${runId} FOR UPDATE OF i,b`
      requireMatching(locked.length === 1, 'FORBIDDEN')
    }
    const rows =
      await db`SELECT i.*,b.account_id,b.run_id,b.binding,b.result_receipt,b.workspace_selector,
      (b.cancel_requested OR h.context_snapshot->'externalExecutionControl'->'cancel' IS NOT NULL) AS cancel_requested,
      h.company_id AS run_company_id,h.agent_id,h.execution_stage,h.driver_kind,h.status AS run_status,
      g.company_id AS agent_company_id,
      a.company_id AS personal_company_id,a.agent_id AS personal_agent_id,r.case_id,r.stage_ref
      FROM issues i JOIN hive_task_bindings b ON b.task_id=i.id
      JOIN heartbeat_runs h ON h.id=b.run_id AND h.company_id=i.company_id
      JOIN agents g ON g.id=h.agent_id AND g.company_id=i.company_id
      LEFT JOIN hive_task_accounts a ON a.account_id=b.account_id
      LEFT JOIN hive_workflow_case_stage_issues r ON r.issue_id=i.id
      WHERE b.account_id=${accountId} AND i.id=${taskId} AND b.run_id=${runId} FOR SHARE OF i,b,h`
    requireMatching(rows.length === 1, 'FORBIDDEN')
    const task = rows[0]
    requireMatching(
      task.case_id === candidate.case_id &&
        (candidate.case_id === null ||
          (task.company_id === candidate.company_id && task.project_id === candidate.project_id))
    )
    requireMatching(
      task.account_id === accountId &&
        task.id === taskId &&
        task.run_id === runId &&
        task.run_company_id === task.company_id &&
        task.agent_company_id === task.company_id &&
        task.driver_kind === 'hive_runtime',
      'FORBIDDEN'
    )
    if (task.case_id === null) {
      requireMatching(
        task.personal_company_id === task.company_id && task.personal_agent_id === task.agent_id,
        'FORBIDDEN'
      )
      return {
        ...task,
        run_scope: {
          kind: 'personal',
          accountId,
          companyId: task.company_id,
          employeeRef: task.agent_id,
          workspaceSelector: task.workspace_selector
        }
      }
    }
    const [row] = await db`SELECT cb.case_id,cb.account_id,cb.company_id,cb.project_id,
      cb.workflow_id,cb.workflow_revision,cb.definition_digest,cb.project_binding_revision,
      cb.team_snapshot_json,cb.team_snapshot_digest,cb.origin_issue_id,
      co.owner_account_ref,co.owner_actor_ref,co.tenant_ref,co.binding_revision AS company_revision,
      pb.workspace_selector,pb.hive_workspace_ref,pb.binding_revision AS project_revision,
      c.company_id AS case_company_id,c.pipeline_id,c.retired_at AS case_retired_at,
      o.company_id AS origin_company_id,o.project_id AS origin_project_id,o.parent_id AS origin_parent_id,
      ol.company_id AS origin_link_company_id,ol.role AS origin_link_role,ol.retired_at AS origin_link_retired_at,
      l.company_id AS link_company_id,l.role AS link_role,l.retired_at AS link_retired_at,
      v.company_id AS revision_company_id,v.project_id AS revision_project_id,
      v.pipeline_id AS revision_pipeline_id,v.definition_digest AS revision_digest,
      v.definition_json->>'workflowId' AS snapshot_workflow_id,v.definition_json->>'definitionDigest' AS snapshot_digest,
      v.definition_json->'definition'->'scope' AS snapshot_scope,
      v.definition_json->'definition'->>'workflowRef' AS snapshot_workflow_ref,
      v.definition_json->'definition'->>'workflowRevision' AS snapshot_revision,
      v.definition_json->'definition' AS snapshot_definition,
      s.pipeline_id AS stage_pipeline_id,s.key AS stage_key,s.kind AS stage_kind,s.config AS stage_config,
      p.company_id AS pipeline_company_id,p.project_id AS pipeline_project_id,p.archived_at AS pipeline_archived_at
      FROM hive_workflow_case_stage_issues r JOIN hive_workflow_case_bindings cb ON cb.case_id=r.case_id
      JOIN pipeline_cases c ON c.id=cb.case_id
      JOIN companies co_native ON co_native.id=cb.company_id
      JOIN hive_workbench_company_bindings co ON co.company_id=co_native.id AND co.account_id=cb.account_id
      JOIN projects project ON project.id=cb.project_id AND project.company_id=cb.company_id
      JOIN hive_workbench_project_bindings pb ON pb.project_id=project.id AND pb.company_id=cb.company_id
      JOIN issues o ON o.id=cb.origin_issue_id
      JOIN pipeline_case_issue_links ol ON ol.case_id=cb.case_id AND ol.issue_id=o.id
      JOIN pipeline_case_issue_links l ON l.case_id=cb.case_id AND l.issue_id=r.issue_id
      JOIN hive_workflow_definition_revisions v ON v.workflow_id=cb.workflow_id AND v.revision=cb.workflow_revision
      JOIN pipelines p ON p.id=v.pipeline_id
      JOIN pipeline_stages s ON s.pipeline_id=p.id AND s.key=${`stage_${digest(task.stage_ref)}`}
      WHERE r.issue_id=${taskId} AND r.case_id=${task.case_id} AND r.stage_ref=${task.stage_ref}
        AND cb.account_id=${accountId} FOR SHARE OF r,cb,c,co_native,co,project,pb,o,ol,l,v,p,s`
    requireMatching(Boolean(row), 'FORBIDDEN')
    const { team, stage } = await validateWorkflowTaskCase(db, task, row, accountId)
    const [agent] = await db`SELECT id,company_id,adapter_type,adapter_config,role FROM agents
      WHERE id=${task.agent_id} AND company_id=${task.company_id} FOR SHARE`
    const role = stage.role
    const employee = team.employees.find((member) => member.role === role)
    requireMatching(
      employee?.employeeRef === task.agent_id &&
        agent?.id === task.agent_id &&
        agent.company_id === task.company_id &&
        agent?.adapter_type === 'hive_runtime' &&
        agent.role === WORKBENCH_UPSTREAM_ROLES[role] &&
        digest(agent.adapter_config) === digest({})
    )
    const scope = {
      kind: 'workbenchCase',
      accountId,
      companyId: task.company_id,
      projectId: row.project_id,
      caseId: row.case_id,
      stageRef: task.stage_ref,
      role,
      employeeRef: employee.employeeRef,
      profileId: employee.profileRef,
      profileRevision: employee.profileRevision,
      workspaceSelector: row.workspace_selector,
      workspaceRef: team.project.hiveWorkspaceRef,
      workflowId: row.workflow_id,
      workflowRevision: Number(row.workflow_revision),
      definitionDigest: row.definition_digest,
      projectBindingRevision: Number(row.project_binding_revision),
      teamSnapshotDigest: row.team_snapshot_digest,
      ownerScope: team.company.ownerScope,
      ownerAccountRef: team.company.ownerAccountRef,
      ownerActorRef: team.company.ownerActorRef,
      companyBindingRevision: team.company.bindingRevision
    }
    validateBinding(task, scope, team)
    return { ...task, run_scope: scope }
  }

  // postgres-js transaction handles expose savepoint, while only pool handles expose begin.
  const read = (db = sql, accountId, taskId, runId, lock = false) =>
    typeof db.begin === 'function'
      ? db.begin((tx) => readInTransaction(tx, accountId, taskId, runId, lock))
      : readInTransaction(db, accountId, taskId, runId, lock)

  const resolveInTransaction = async (db, companyId, runId, accountId) => {
    z.string().uuid().parse(companyId)
    z.string().uuid().parse(runId)
    if (accountId !== undefined) {
      requireTaskRepositoryScope(accountId)
    }
    const rows = await db`SELECT b.account_id,b.task_id FROM hive_task_bindings b
      JOIN issues i ON i.id=b.task_id
      JOIN heartbeat_runs h ON h.id=b.run_id AND h.company_id=i.company_id
      JOIN agents g ON g.id=h.agent_id AND g.company_id=i.company_id
      WHERE i.company_id=${companyId} AND b.run_id=${runId} AND h.driver_kind='hive_runtime'`
    requireMatching(
      rows.length === 1 && (accountId === undefined || rows[0].account_id === accountId),
      'FORBIDDEN'
    )
    const task = await readInTransaction(db, rows[0].account_id, rows[0].task_id, runId, false)
    requireMatching(task.company_id === companyId, 'FORBIDDEN')
    return task
  }
  const resolve = (db = sql, companyId, runId, accountId) =>
    typeof db.begin === 'function'
      ? db.begin((tx) => resolveInTransaction(tx, companyId, runId, accountId))
      : resolveInTransaction(db, companyId, runId, accountId)
  return { read, resolve }
}
