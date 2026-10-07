import { randomUUID } from 'node:crypto'
import {
  HiveWorkflowListQuerySchema,
  HiveWorkflowReadQuerySchema,
  HiveWorkflowSaveSchema,
  HiveWorkflowPageSchema,
  HiveWorkflowSnapshotSchema
} from '../../../src/shared/hive-task-workflows.ts'
import { WorkflowDefinitionSchema } from '../../../src/shared/task-workflow/workflow-definition.ts'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  requireWorkbenchProject,
  readWorkbenchTeam,
  refuseWorkbench,
  workbenchOwnerReferences
} from './team-workbench-repository-records.mjs'
import { recordWorkbenchRequest, replayWorkbenchRequest } from './team-workbench-repository.mjs'
import { assertWorkflowPipeline, createWorkflowPipeline } from './workflow-pipeline-definition.mjs'
import { repairWorkflowPipelineReview } from './workflow-pipeline-review-migration.mjs'

async function workflowHead(db, project, workflowId) {
  const [head] = await db`SELECT h.*,p.company_id AS pipeline_company_id,
    p.project_id AS pipeline_project_id,p.archived_at FROM hive_workflow_definitions h
    JOIN pipelines p ON p.id=h.workflow_id
    WHERE h.workflow_id=${workflowId} AND h.company_id=${project.companyId} AND h.project_id=${project.id}
    FOR UPDATE OF h,p`
  if (!head) {
    return refuseWorkbench('FORBIDDEN')
  }
  if (
    head.pipeline_company_id !== project.companyId ||
    head.pipeline_project_id !== project.id ||
    head.archived_at !== null
  ) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  return head
}

async function readRevision(
  db,
  project,
  head,
  revision = Number(head.latest_revision),
  projectBindingRevision = project.binding.bindingRevision
) {
  const [row] =
    await db`SELECT r.definition_json,r.definition_digest,r.company_id AS revision_company_id,
    r.project_id AS revision_project_id,r.workflow_id,r.revision,p.*
    FROM hive_workflow_definition_revisions r JOIN pipelines p ON p.id=r.pipeline_id
    WHERE r.workflow_id=${head.workflow_id} AND r.revision=${revision} FOR UPDATE OF p`
  if (!row) {
    return refuseWorkbench('FORBIDDEN')
  }
  const parsed = HiveWorkflowSnapshotSchema.safeParse({
    ...row.definition_json,
    projectBindingRevision
  })
  if (!parsed.success) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  const snapshot = parsed.data
  if (
    row.revision_company_id !== project.companyId ||
    row.revision_project_id !== project.id ||
    snapshot.workflowId !== head.workflow_id ||
    snapshot.definition.workflowRevision !== revision ||
    snapshot.definition.scope.companyRef !== project.companyId ||
    snapshot.definition.scope.projectRef !== project.id ||
    snapshot.definitionDigest !== row.definition_digest
  ) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  await repairWorkflowPipelineReview(db, snapshot, row, project)
  await assertWorkflowPipeline(db, snapshot, row)
  return { snapshot, pipelineId: row.id }
}

async function readSnapshot(db, project, head, revision) {
  return (await readRevision(db, project, head, revision)).snapshot
}

/** Reuse inside an authorized project transaction; cases retain their admission binding revision. */
export async function readWorkflowDefinitionRevision(
  db,
  project,
  workflowId,
  revision,
  projectBindingRevision = project.binding.bindingRevision
) {
  const head = await workflowHead(db, project, workflowId)
  return readRevision(db, project, head, revision, projectBindingRevision)
}

/** The Gateway edits Paperclip business definitions; execution remains owned by Hive Runtime. */
export function createWorkflowDefinitionRepository(sql) {
  return {
    async listWorkflows(accountId, rawQuery) {
      const query = HiveWorkflowListQuerySchema.parse(rawQuery)
      workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        const { project } = await requireWorkbenchProject(db, accountId, query.projectId)
        const heads = await db`SELECT workflow_id FROM hive_workflow_definitions
          WHERE company_id=${project.companyId} AND project_id=${project.id}
            AND (${query.after ?? null}::uuid IS NULL OR workflow_id>${query.after ?? null}::uuid)
          ORDER BY workflow_id LIMIT ${query.limit + 1}`
        const items = []
        let bytes = 128
        for (const row of heads.slice(0, query.limit)) {
          const snapshot = await readSnapshot(
            db,
            project,
            await workflowHead(db, project, row.workflow_id)
          )
          const length = Buffer.byteLength(JSON.stringify(snapshot)) + 1
          if (items.length && bytes + length > 384 * 1024) {
            break
          }
          bytes += length
          items.push(snapshot)
        }
        return HiveWorkflowPageSchema.parse({
          items,
          nextCursor: heads.length > items.length ? items.at(-1).workflowId : null
        })
      })
    },
    async getWorkflow(accountId, rawQuery) {
      const query = HiveWorkflowReadQuerySchema.parse(rawQuery)
      workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        const { project } = await requireWorkbenchProject(db, accountId, query.projectId)
        const head = await workflowHead(db, project, query.workflowId)
        return readSnapshot(db, project, head, query.revision)
      })
    },
    async saveWorkflow(accountId, rawInput) {
      const input = HiveWorkflowSaveSchema.parse(rawInput)
      const owner = workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        await db`SELECT pg_advisory_xact_lock(hashtextextended(${`hive-workbench:${accountId}`},0))`
        const { project } = await requireWorkbenchProject(db, accountId, input.projectId, true)
        const replay = await replayWorkbenchRequest(
          db,
          accountId,
          input,
          'workflows.save',
          HiveWorkflowSnapshotSchema
        )
        if (replay) {
          return replay
        }
        if (
          project.binding.bindingRevision !== input.expectedProjectRevision ||
          input.expectedRevision >= Number.MAX_SAFE_INTEGER
        ) {
          return refuseWorkbench('REVISION_CONFLICT')
        }
        const team = await readWorkbenchTeam(db, accountId, project.id)
        const workflowId = input.workflowId ?? randomUUID()
        if (input.workflowId) {
          const head = await workflowHead(db, project, workflowId)
          if (Number(head.latest_revision) !== input.expectedRevision) {
            return refuseWorkbench('REVISION_CONFLICT')
          }
          await readSnapshot(db, project, head)
        }
        const definition = WorkflowDefinitionSchema.parse({
          contractVersion: 1,
          kind: 'workflow.definition',
          scope: project.binding.scope,
          workflowRef: workflowId,
          workflowRevision: input.expectedRevision + 1,
          stages: input.stages,
          maxParallelism: input.maxParallelism,
          maxDurationMs: input.maxDurationMs
        })
        const snapshot = HiveWorkflowSnapshotSchema.parse({
          workflowId,
          name: input.name,
          definition,
          definitionDigest: digest({ name: input.name, definition }),
          projectBindingRevision: project.binding.bindingRevision
        })
        if (Buffer.byteLength(JSON.stringify(snapshot)) > 64 * 1024) {
          return refuseWorkbench('INVALID_REQUEST')
        }
        const pipelineId = input.workflowId ? randomUUID() : workflowId
        await createWorkflowPipeline(
          db,
          snapshot,
          pipelineId,
          owner.actorRef,
          team.employees.map((employee) => employee.binding)
        )
        if (!input.workflowId) {
          await db`INSERT INTO hive_workflow_definitions(workflow_id,company_id,project_id,latest_revision)
            VALUES(${workflowId},${project.companyId},${project.id},${definition.workflowRevision})`
        } else {
          const changed =
            await db`UPDATE hive_workflow_definitions SET latest_revision=${definition.workflowRevision}
            WHERE workflow_id=${workflowId} AND company_id=${project.companyId} AND project_id=${project.id}
              AND latest_revision=${input.expectedRevision} RETURNING workflow_id`
          if (!changed.length) {
            return refuseWorkbench('REVISION_CONFLICT')
          }
        }
        await db`INSERT INTO hive_workflow_definition_revisions
          (workflow_id,company_id,project_id,revision,pipeline_id,definition_json,definition_digest)
          VALUES(${workflowId},${project.companyId},${project.id},${definition.workflowRevision},${pipelineId},
            ${db.json(snapshot)},${snapshot.definitionDigest})`
        await db`INSERT INTO activity_log(company_id,actor_type,actor_id,action,entity_type,entity_id,responsible_user_id,details)
          VALUES(${project.companyId},'user',${owner.actorRef},'hive.workflow.definition_saved','pipeline',${pipelineId},
            ${owner.actorRef},${db.json({
              workflowId,
              workflowRevision: definition.workflowRevision,
              definitionDigest: snapshot.definitionDigest,
              projectId: project.id,
              projectBindingRevision: project.binding.bindingRevision
            })})`
        return recordWorkbenchRequest(
          db,
          accountId,
          input,
          'workflows.save',
          project.companyId,
          snapshot
        )
      })
    }
  }
}
