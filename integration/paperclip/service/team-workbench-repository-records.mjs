import {
  HiveWorkbenchCompanySchema,
  HiveWorkbenchProjectSchema,
  HiveWorkbenchTeamSchema
} from '../../../src/shared/hive-team-workbench.ts'
import { canonicalAgentSessionDigest } from '../../../src/shared/agent-session-mutation-envelope.ts'

export const WORKBENCH_UPSTREAM_ROLES = Object.freeze({
  product: 'pm',
  developer: 'engineer',
  tester: 'qa',
  ops: 'devops'
})

export function refuseWorkbench(code) {
  throw Object.assign(new Error(code), { code })
}

export function workbenchOwnerReferences(accountId) {
  if (typeof accountId !== 'string' || !accountId || accountId.length > 512) {
    return refuseWorkbench('FORBIDDEN')
  }
  const digest = canonicalAgentSessionDigest(accountId)
  return { accountRef: `account:${digest}`, actorRef: `actor:${digest}` }
}

export function companyFromWorkbenchRow(row, accountId) {
  const owner = workbenchOwnerReferences(accountId)
  if (
    row.owner_account_ref !== owner.accountRef ||
    row.owner_actor_ref !== owner.actorRef ||
    row.tenant_ref !== owner.accountRef
  ) {
    return refuseWorkbench('FORBIDDEN')
  }
  return HiveWorkbenchCompanySchema.parse({
    id: row.company_id,
    name: row.company_name,
    binding: {
      contractVersion: 1,
      kind: 'workflow.company-binding',
      companyRef: row.company_id,
      ownerScope: { kind: 'personalTenant', tenantRef: row.tenant_ref },
      ownerAccountRef: row.owner_account_ref,
      ownerActorRef: row.owner_actor_ref,
      bindingRevision: Number(row.company_revision)
    }
  })
}

export function projectFromWorkbenchRow(row) {
  return HiveWorkbenchProjectSchema.parse({
    id: row.project_id,
    companyId: row.company_id,
    name: row.project_name,
    workspaceSelector: row.workspace_selector,
    binding: {
      contractVersion: 1,
      kind: 'workflow.project-binding',
      scope: { companyRef: row.company_id, projectRef: row.project_id },
      hiveWorkspaceRef: row.hive_workspace_ref,
      bindingRevision: Number(row.project_revision)
    }
  })
}

export async function requireWorkbenchCompany(db, accountId, companyId) {
  const [row] = await db`SELECT c.id AS company_id,c.name AS company_name,
    b.owner_account_ref,b.owner_actor_ref,b.tenant_ref,b.binding_revision AS company_revision
    FROM companies c JOIN hive_workbench_company_bindings b ON b.company_id=c.id
    WHERE c.id=${companyId} AND b.account_id=${accountId} FOR SHARE OF c,b`
  if (!row) {
    return refuseWorkbench('FORBIDDEN')
  }
  return companyFromWorkbenchRow(row, accountId)
}

export async function requireWorkbenchProject(db, accountId, projectId, write = false) {
  // Writers lock the project before employees; a reader cannot hold the project while waiting on its changed agents.
  const [row] = write
    ? await db`SELECT c.id AS company_id,c.name AS company_name,
        cb.owner_account_ref,cb.owner_actor_ref,cb.tenant_ref,cb.binding_revision AS company_revision,
        p.id AS project_id,p.name AS project_name,pb.workspace_selector,pb.hive_workspace_ref,
        pb.binding_revision AS project_revision
        FROM projects p JOIN hive_workbench_project_bindings pb ON pb.project_id=p.id AND pb.company_id=p.company_id
        JOIN companies c ON c.id=p.company_id
        JOIN hive_workbench_company_bindings cb ON cb.company_id=c.id
        WHERE p.id=${projectId} AND cb.account_id=${accountId} FOR UPDATE OF p,pb FOR SHARE OF c,cb`
    : await db`SELECT c.id AS company_id,c.name AS company_name,
        cb.owner_account_ref,cb.owner_actor_ref,cb.tenant_ref,cb.binding_revision AS company_revision,
        p.id AS project_id,p.name AS project_name,pb.workspace_selector,pb.hive_workspace_ref,
        pb.binding_revision AS project_revision
        FROM projects p JOIN hive_workbench_project_bindings pb ON pb.project_id=p.id AND pb.company_id=p.company_id
        JOIN companies c ON c.id=p.company_id
        JOIN hive_workbench_company_bindings cb ON cb.company_id=c.id
        WHERE p.id=${projectId} AND cb.account_id=${accountId} FOR SHARE OF c,cb,p,pb`
  if (!row) {
    return refuseWorkbench('FORBIDDEN')
  }
  return {
    company: companyFromWorkbenchRow(row, accountId),
    project: projectFromWorkbenchRow(row)
  }
}

export async function readWorkbenchTeam(db, accountId, projectId) {
  const objects = await requireWorkbenchProject(db, accountId, projectId)
  const rows =
    await db`SELECT a.id AS employee_id,a.name,a.role AS upstream_role,a.adapter_type,a.adapter_config,
    b.company_id,b.project_id,b.role,b.profile_ref,b.profile_revision,b.binding_revision
    FROM hive_workbench_employee_bindings b JOIN agents a ON a.id=b.employee_id AND a.company_id=b.company_id
    WHERE b.project_id=${projectId} AND b.company_id=${objects.company.id}
    ORDER BY b.role LIMIT 5 FOR SHARE OF a,b`
  if (
    rows.some(
      (row) =>
        row.adapter_type !== 'hive_runtime' ||
        row.upstream_role !== WORKBENCH_UPSTREAM_ROLES[row.role] ||
        canonicalAgentSessionDigest(row.adapter_config) !== canonicalAgentSessionDigest({}) ||
        Number(row.binding_revision) !== objects.project.binding.bindingRevision
    )
  ) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  return HiveWorkbenchTeamSchema.parse({
    ...objects,
    employees: rows.map((row) => ({
      name: row.name,
      binding: {
        contractVersion: 1,
        kind: 'workflow.employee-binding',
        scope: { companyRef: row.company_id, projectRef: row.project_id },
        employeeRef: row.employee_id,
        role: row.role,
        adapterType: 'hive_runtime',
        executor: 'codex',
        profileRef: row.profile_ref,
        profileRevision: row.profile_revision,
        bindingRevision: Number(row.binding_revision)
      }
    })),
    executionAvailability: {
      available: false,
      reason: rows.length ? 'EXECUTION_ISOLATION_UNAVAILABLE' : 'TEAM_NOT_CONFIGURED'
    }
  })
}
