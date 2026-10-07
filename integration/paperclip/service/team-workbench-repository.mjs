import { randomUUID } from 'node:crypto'
import {
  HiveWorkbenchCompanyCreateSchema,
  HiveWorkbenchCompanyPageSchema,
  HiveWorkbenchCompanySchema,
  HiveWorkbenchObjectIdInputSchema,
  HiveWorkbenchPageQuerySchema,
  HiveWorkbenchProjectCreateSchema,
  HiveWorkbenchProjectPageSchema,
  HiveWorkbenchProjectSchema,
  HiveWorkbenchProjectsQuerySchema,
  HiveWorkbenchTeamConfigureSchema,
  HiveWorkbenchTeamSchema
} from '../../../src/shared/hive-team-workbench.ts'
import { TaskOpaqueRef } from '../../../src/shared/task-execution/task-execution-primitives.ts'
import { canonicalAgentSessionDigest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  companyFromWorkbenchRow,
  projectFromWorkbenchRow,
  readWorkbenchTeam,
  refuseWorkbench,
  requireWorkbenchCompany,
  requireWorkbenchProject,
  WORKBENCH_UPSTREAM_ROLES,
  workbenchOwnerReferences
} from './team-workbench-repository-records.mjs'

export const WorkbenchProjectBindingCreateSchema = HiveWorkbenchProjectCreateSchema.extend({
  hiveWorkspaceRef: TaskOpaqueRef
})

export async function replayWorkbenchRequest(db, accountId, input, operation, responseSchema) {
  const [receipt] = await db`SELECT operation,payload_fingerprint,company_id,response_json
    FROM hive_workbench_request_receipts WHERE account_id=${accountId} AND request_id=${input.requestId}`
  if (!receipt) {
    return null
  }
  await requireWorkbenchCompany(db, accountId, receipt.company_id)
  if (
    receipt.operation !== operation ||
    receipt.payload_fingerprint !== canonicalAgentSessionDigest({ operation, input })
  ) {
    return refuseWorkbench('IDEMPOTENCY_CONFLICT')
  }
  const parsed = responseSchema.safeParse(receipt.response_json)
  if (!parsed.success) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  const response = parsed.data
  const responseCompanyId =
    operation === 'companies.create'
      ? response.id
      : operation === 'projects.create'
        ? response.companyId
        : operation === 'workflows.save'
          ? response.definition.scope.companyRef
          : operation === 'cases.create'
            ? response.binding.scope.companyRef
            : response.company.id
  if (
    responseCompanyId !== receipt.company_id ||
    (operation === 'team.configure' && response.project.id !== input.projectId) ||
    (operation === 'projects.create' &&
      response.binding.hiveWorkspaceRef !== input.hiveWorkspaceRef) ||
    (operation === 'cases.create' &&
      (response.binding.scope.projectRef !== input.projectId ||
        response.binding.workflowRef !== input.workflowId ||
        response.binding.workflowRevision !== input.workflowRevision ||
        response.definitionDigest !== input.definitionDigest ||
        response.projectBindingRevision !== input.expectedProjectRevision ||
        response.title !== input.title ||
        response.requirement !== input.requirement)) ||
    (operation === 'workflows.save' &&
      (response.definition.scope.projectRef !== input.projectId ||
        (input.workflowId && response.workflowId !== input.workflowId) ||
        response.definition.workflowRevision !== input.expectedRevision + 1 ||
        response.projectBindingRevision !== input.expectedProjectRevision ||
        canonicalAgentSessionDigest({
          name: response.name,
          stages: response.definition.stages,
          maxParallelism: response.definition.maxParallelism,
          maxDurationMs: response.definition.maxDurationMs
        }) !==
          canonicalAgentSessionDigest({
            name: input.name,
            stages: input.stages,
            maxParallelism: input.maxParallelism,
            maxDurationMs: input.maxDurationMs
          })))
  ) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  return response
}

export async function recordWorkbenchRequest(db, accountId, input, operation, companyId, response) {
  await db`INSERT INTO hive_workbench_request_receipts
    (account_id,request_id,operation,payload_fingerprint,company_id,response_json)
    VALUES(${accountId},${input.requestId},${operation},${canonicalAgentSessionDigest({ operation, input })},${companyId},${db.json(response)})`
  return response
}

function workbenchPage(rows, limit, convert, schema) {
  const items = rows.slice(0, limit).map(convert)
  return schema.parse({ items, nextCursor: rows.length > limit ? items.at(-1).id : null })
}

/** Paperclip owns the business rows; Hive bindings provide scope and immutable request receipts. */
export function createTeamWorkbenchRepository(sql) {
  const mutate = (accountId, run) => {
    workbenchOwnerReferences(accountId)
    return sql.begin(async (db) => {
      await db`SELECT pg_advisory_xact_lock(hashtextextended(${`hive-workbench:${accountId}`}, 0))`
      return run(db)
    })
  }
  return {
    async listCompanies(accountId, rawQuery) {
      const query = HiveWorkbenchPageQuerySchema.parse(rawQuery)
      workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        const rows = await db`SELECT c.id AS company_id,c.name AS company_name,
          b.owner_account_ref,b.owner_actor_ref,b.tenant_ref,b.binding_revision AS company_revision
          FROM companies c JOIN hive_workbench_company_bindings b ON b.company_id=c.id
          WHERE b.account_id=${accountId} AND (${query.after ?? null}::uuid IS NULL OR c.id>${query.after ?? null}::uuid)
          ORDER BY c.id ASC LIMIT ${query.limit + 1} FOR SHARE OF c,b`
        return workbenchPage(
          rows,
          query.limit,
          (row) => companyFromWorkbenchRow(row, accountId),
          HiveWorkbenchCompanyPageSchema
        )
      })
    },
    async createCompany(accountId, rawInput) {
      const input = HiveWorkbenchCompanyCreateSchema.parse(rawInput)
      const operation = 'companies.create'
      return mutate(accountId, async (db) => {
        const replay = await replayWorkbenchRequest(
          db,
          accountId,
          input,
          operation,
          HiveWorkbenchCompanySchema
        )
        if (replay) {
          return replay
        }
        const id = randomUUID()
        const owner = workbenchOwnerReferences(accountId)
        await db`INSERT INTO companies(id,name,issue_prefix,feedback_data_sharing_enabled)
          VALUES(${id},${input.name},${`HIVE${canonicalAgentSessionDigest(id).slice(0, 16)}`},false)`
        await db`INSERT INTO hive_workbench_company_bindings
          (company_id,account_id,owner_account_ref,owner_actor_ref,tenant_ref)
          VALUES(${id},${accountId},${owner.accountRef},${owner.actorRef},${owner.accountRef})`
        const company = await requireWorkbenchCompany(db, accountId, id)
        return recordWorkbenchRequest(db, accountId, input, operation, id, company)
      })
    },
    async listProjects(accountId, rawQuery) {
      const query = HiveWorkbenchProjectsQuerySchema.parse(rawQuery)
      workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        await requireWorkbenchCompany(db, accountId, query.companyId)
        const rows = await db`SELECT p.id AS project_id,p.company_id,p.name AS project_name,
          b.workspace_selector,b.hive_workspace_ref,b.binding_revision AS project_revision
          FROM projects p JOIN hive_workbench_project_bindings b ON b.project_id=p.id AND b.company_id=p.company_id
          WHERE b.company_id=${query.companyId} AND (${query.after ?? null}::uuid IS NULL OR p.id>${query.after ?? null}::uuid)
          ORDER BY p.id ASC LIMIT ${query.limit + 1} FOR SHARE OF p,b`
        return workbenchPage(
          rows,
          query.limit,
          projectFromWorkbenchRow,
          HiveWorkbenchProjectPageSchema
        )
      })
    },
    async createProject(accountId, rawInput) {
      const input = WorkbenchProjectBindingCreateSchema.parse(rawInput)
      const operation = 'projects.create'
      return mutate(accountId, async (db) => {
        const replay = await replayWorkbenchRequest(
          db,
          accountId,
          input,
          operation,
          HiveWorkbenchProjectSchema
        )
        if (replay) {
          return replay
        }
        await requireWorkbenchCompany(db, accountId, input.companyId)
        const id = randomUUID()
        await db`INSERT INTO projects(id,company_id,name) VALUES(${id},${input.companyId},${input.name})`
        await db`INSERT INTO hive_workbench_project_bindings
          (project_id,company_id,workspace_selector,hive_workspace_ref)
          VALUES(${id},${input.companyId},${input.workspaceSelector},${input.hiveWorkspaceRef})`
        const { project } = await requireWorkbenchProject(db, accountId, id)
        return recordWorkbenchRequest(db, accountId, input, operation, input.companyId, project)
      })
    },
    async getTeam(accountId, rawProjectId) {
      const projectId = HiveWorkbenchObjectIdInputSchema.parse(rawProjectId)
      workbenchOwnerReferences(accountId)
      return sql.begin((db) => readWorkbenchTeam(db, accountId, projectId))
    },
    async configureTeam(accountId, rawInput) {
      const input = HiveWorkbenchTeamConfigureSchema.parse(rawInput)
      const operation = 'team.configure'
      return mutate(accountId, async (db) => {
        const replay = await replayWorkbenchRequest(
          db,
          accountId,
          input,
          operation,
          HiveWorkbenchTeamSchema
        )
        if (replay) {
          return replay
        }
        const { company, project } = await requireWorkbenchProject(
          db,
          accountId,
          input.projectId,
          true
        )
        if (project.binding.bindingRevision !== input.expectedRevision) {
          return refuseWorkbench('REVISION_CONFLICT')
        }
        const revision = input.expectedRevision + 1
        if (!Number.isSafeInteger(revision)) {
          return refuseWorkbench('CAPACITY_EXCEEDED')
        }
        const existing = await db`SELECT employee_id,role FROM hive_workbench_employee_bindings
          WHERE project_id=${project.id} AND company_id=${company.id} ORDER BY role LIMIT 5 FOR UPDATE`
        if (existing.length !== 0 && existing.length !== 4) {
          return refuseWorkbench('REVISION_CONFLICT')
        }
        for (const employee of input.employees) {
          const previous = existing.find((row) => row.role === employee.role)
          const id = previous?.employee_id ?? randomUUID()
          if (previous) {
            const changed =
              await db`UPDATE agents SET name=${employee.name},role=${WORKBENCH_UPSTREAM_ROLES[employee.role]},
              adapter_config='{}'::jsonb,updated_at=now()
              WHERE id=${id} AND company_id=${company.id} AND adapter_type='hive_runtime' RETURNING id`
            if (changed.length !== 1) {
              return refuseWorkbench('REVISION_CONFLICT')
            }
            await db`UPDATE hive_workbench_employee_bindings SET profile_ref=${employee.profileRef},
              profile_revision=${employee.profileRevision},binding_revision=${revision}
              WHERE employee_id=${id} AND project_id=${project.id} AND company_id=${company.id}`
          } else {
            await db`INSERT INTO agents(id,company_id,name,role,adapter_type,adapter_config)
              VALUES(${id},${company.id},${employee.name},${WORKBENCH_UPSTREAM_ROLES[employee.role]},'hive_runtime','{}'::jsonb)`
            await db`INSERT INTO hive_workbench_employee_bindings
              (employee_id,project_id,company_id,role,profile_ref,profile_revision,binding_revision)
              VALUES(${id},${project.id},${company.id},${employee.role},${employee.profileRef},${employee.profileRevision},${revision})`
          }
        }
        const changed =
          await db`UPDATE hive_workbench_project_bindings SET binding_revision=${revision}
          WHERE project_id=${project.id} AND company_id=${company.id} AND binding_revision=${input.expectedRevision} RETURNING project_id`
        if (changed.length !== 1) {
          return refuseWorkbench('REVISION_CONFLICT')
        }
        const team = await readWorkbenchTeam(db, accountId, project.id)
        return recordWorkbenchRequest(db, accountId, input, operation, company.id, team)
      })
    }
  }
}
