import { randomUUID } from 'node:crypto'
import {
  HiveWorkflowCaseCreateSchema,
  HiveWorkflowCaseCreateReplySchema,
  HiveWorkflowCaseListQuerySchema,
  HiveWorkflowCaseReadQuerySchema,
  HiveWorkflowCasePageSchema,
  HiveWorkflowCaseViewSchema
} from '../../../src/shared/hive-workflow-cases.ts'
import { WorkflowTeamBindingSchema } from '../../../src/shared/task-workflow/workflow-bindings.ts'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  readWorkbenchTeam,
  requireWorkbenchProject,
  refuseWorkbench,
  workbenchOwnerReferences
} from './team-workbench-repository-records.mjs'
import { recordWorkbenchRequest, replayWorkbenchRequest } from './team-workbench-repository.mjs'
import { readWorkflowDefinitionRevision } from './workflow-definition-repository.mjs'
import {
  readWorkflowCaseSummary,
  readWorkflowCaseView,
  workflowCaseAdmissionFingerprint
} from './workflow-case-records.mjs'

async function createIssue(db, project, owner, input, parentId, employeeId, number, prefix) {
  const id = randomUUID()
  await db`INSERT INTO issues(id,company_id,project_id,parent_id,title,description,status,
    assignee_agent_id,created_by_user_id,responsible_user_id,issue_number,identifier)
    VALUES(${id},${project.companyId},${project.id},${parentId},${input.title},${input.description},'backlog',
      ${employeeId},${owner.actorRef},${owner.actorRef},${number},${`${prefix}-${number}`})`
  return id
}

/** Admission only: upstream cases and Issues own business state; no execution is queued. */
export function createWorkflowCaseRepository(sql) {
  return {
    async createWorkflowCase(accountId, rawInput) {
      const input = HiveWorkflowCaseCreateSchema.parse(rawInput)
      const owner = workbenchOwnerReferences(accountId)
      const operation = 'cases.create'
      const payloadFingerprint = digest({ operation, input })
      const reply = (view, replayed) =>
        HiveWorkflowCaseCreateReplySchema.parse({
          admission: { requestId: input.requestId, caseId: view.id, payloadFingerprint, replayed },
          view
        })
      return sql.begin(async (db) => {
        await db`SELECT pg_advisory_xact_lock(hashtextextended(${`hive-workbench:${accountId}`},0))`
        const { project } = await requireWorkbenchProject(db, accountId, input.projectId, true)
        const replay = await replayWorkbenchRequest(
          db,
          accountId,
          input,
          operation,
          HiveWorkflowCaseViewSchema
        )
        if (replay) {
          const current = await readWorkflowCaseView(
            db,
            accountId,
            project,
            replay.id,
            input.requestId
          )
          if (
            workflowCaseAdmissionFingerprint(current) !== workflowCaseAdmissionFingerprint(replay)
          ) {
            return refuseWorkbench('REVISION_CONFLICT')
          }
          return reply(current, true)
        }
        if (project.binding.bindingRevision !== input.expectedProjectRevision) {
          return refuseWorkbench('REVISION_CONFLICT')
        }
        const configured = await readWorkbenchTeam(db, accountId, project.id)
        if (configured.employees.length !== 4) {
          return refuseWorkbench('REVISION_CONFLICT')
        }
        const team = WorkflowTeamBindingSchema.parse({
          contractVersion: 1,
          kind: 'workflow.team-binding',
          company: configured.company.binding,
          project: configured.project.binding,
          employees: configured.employees.map((employee) => employee.binding)
        })
        const { snapshot, pipelineId } = await readWorkflowDefinitionRevision(
          db,
          project,
          input.workflowId,
          input.workflowRevision
        )
        if (snapshot.definitionDigest !== input.definitionDigest) {
          return refuseWorkbench('REVISION_CONFLICT')
        }
        const entry = snapshot.definition.stages.find(
          (stage) => stage.role === 'product' && stage.dependsOn.length === 0
        )
        if (!entry) {
          return refuseWorkbench('REVISION_CONFLICT')
        }
        const [stage] = await db`SELECT id FROM pipeline_stages
          WHERE pipeline_id=${pipelineId} AND key=${`stage_${digest(entry.stageRef)}`} AND kind='working' FOR SHARE`
        if (!stage) {
          return refuseWorkbench('REVISION_CONFLICT')
        }
        const issueCount = snapshot.definition.stages.length + 1
        const [counter] =
          await db`UPDATE companies SET issue_counter=issue_counter+${issueCount},updated_at=now()
          WHERE id=${project.companyId} AND issue_counter<=${2_147_483_647 - issueCount}
          RETURNING issue_counter,issue_prefix`
        if (!counter) {
          return refuseWorkbench('REVISION_CONFLICT')
        }
        const firstNumber = counter.issue_counter - issueCount + 1
        const originTaskId = await createIssue(
          db,
          project,
          owner,
          { title: input.title, description: input.requirement },
          null,
          null,
          firstNumber,
          counter.issue_prefix
        )
        const caseId = randomUUID()
        await db`INSERT INTO pipeline_cases(id,company_id,pipeline_id,stage_id,case_key,title,created_by_user_id)
          VALUES(${caseId},${project.companyId},${pipelineId},${stage.id},${input.requestId},${input.title},
            ${owner.actorRef})`
        await db`INSERT INTO hive_workflow_case_bindings(case_id,account_id,company_id,project_id,
          workflow_id,workflow_revision,definition_digest,project_binding_revision,
          team_snapshot_json,team_snapshot_digest,origin_issue_id)
          VALUES(${caseId},${accountId},${project.companyId},${project.id},${input.workflowId},
            ${input.workflowRevision},${input.definitionDigest},${input.expectedProjectRevision},
            ${db.json(team)},${digest(team)},${originTaskId})`
        await db`INSERT INTO pipeline_case_issue_links(company_id,case_id,issue_id,role)
          VALUES(${project.companyId},${caseId},${originTaskId},'origin')`
        for (const [index, definitionStage] of snapshot.definition.stages.entries()) {
          const employee = team.employees.find((member) => member.role === definitionStage.role)
          const issueId = await createIssue(
            db,
            project,
            owner,
            {
              title: `${definitionStage.role}: ${input.title}`.slice(0, 240),
              description: `Workflow stage ${definitionStage.stageRef}\nAcceptance criteria:\n${definitionStage.acceptanceCriteria.join('\n')}`
            },
            originTaskId,
            employee.employeeRef,
            firstNumber + index + 1,
            counter.issue_prefix
          )
          await db`INSERT INTO pipeline_case_issue_links(company_id,case_id,issue_id,role)
            VALUES(${project.companyId},${caseId},${issueId},'work')`
          await db`INSERT INTO hive_workflow_case_stage_issues(case_id,stage_ref,issue_id)
            VALUES(${caseId},${definitionStage.stageRef},${issueId})`
        }
        await db`INSERT INTO pipeline_case_events(company_id,case_id,type,actor_type,actor_user_id,to_stage_id,payload)
          VALUES(${project.companyId},${caseId},'ingested','user',${owner.actorRef},${stage.id},
            ${db.json({
              caseKey: input.requestId,
              requestKey: null,
              parentCaseVersion: null,
              workflowRef: input.workflowId,
              workflowRevision: input.workflowRevision,
              definitionDigest: input.definitionDigest,
              originTaskId
            })})`
        await db`INSERT INTO activity_log(company_id,actor_type,actor_id,action,entity_type,entity_id,responsible_user_id,details)
          VALUES(${project.companyId},'user',${owner.actorRef},'hive.workflow.case_created','pipeline_case',${caseId},
            ${owner.actorRef},${db.json({
              projectId: project.id,
              workflowId: input.workflowId,
              workflowRevision: input.workflowRevision,
              definitionDigest: input.definitionDigest,
              projectBindingRevision: input.expectedProjectRevision,
              originTaskId,
              stageIssueCount: issueCount - 1
            })})`
        const view = await readWorkflowCaseView(db, accountId, project, caseId)
        await recordWorkbenchRequest(db, accountId, input, operation, project.companyId, view)
        return reply(view, false)
      })
    },
    async listWorkflowCases(accountId, rawQuery) {
      const query = HiveWorkflowCaseListQuerySchema.parse(rawQuery)
      workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        const { project } = await requireWorkbenchProject(db, accountId, query.projectId)
        if (query.workflowId) {
          await readWorkflowDefinitionRevision(db, project, query.workflowId)
        }
        const rows = await db`SELECT case_id,workflow_id,workflow_revision,project_binding_revision
          FROM hive_workflow_case_bindings
          WHERE account_id=${accountId} AND company_id=${project.companyId} AND project_id=${project.id}
            AND (${query.workflowId ?? null}::uuid IS NULL OR workflow_id=${query.workflowId ?? null}::uuid)
            AND (${query.after ?? null}::uuid IS NULL OR case_id>${query.after ?? null}::uuid)
          ORDER BY case_id LIMIT ${query.limit + 1}`
        const items = [],
          revisions = new Map()
        // Match definition-list lock order while retaining the original Case page order.
        const references = rows
          .slice(0, query.limit)
          .toSorted((a, b) =>
            a.workflow_id < b.workflow_id
              ? -1
              : a.workflow_id > b.workflow_id
                ? 1
                : Number(a.workflow_revision) - Number(b.workflow_revision) ||
                  Number(a.project_binding_revision) - Number(b.project_binding_revision)
          )
        for (const row of references) {
          const key = `${row.workflow_id}:${row.workflow_revision}:${row.project_binding_revision}`
          if (!revisions.has(key)) {
            revisions.set(
              key,
              await readWorkflowDefinitionRevision(
                db,
                project,
                row.workflow_id,
                Number(row.workflow_revision),
                Number(row.project_binding_revision)
              )
            )
          }
        }
        let bytes = 128
        for (const row of rows.slice(0, query.limit)) {
          const summary = await readWorkflowCaseSummary(
            db,
            accountId,
            project,
            row.case_id,
            revisions
          )
          const length = Buffer.byteLength(JSON.stringify(summary)) + 1
          if (items.length && bytes + length > 384 * 1024) {
            break
          }
          bytes += length
          items.push(summary)
        }
        return HiveWorkflowCasePageSchema.parse({
          items,
          nextCursor: rows.length > items.length ? items.at(-1).id : null
        })
      })
    },
    async getWorkflowCase(accountId, rawQuery) {
      const query = HiveWorkflowCaseReadQuerySchema.parse(rawQuery)
      workbenchOwnerReferences(accountId)
      return sql.begin(async (db) => {
        const { project } = await requireWorkbenchProject(db, accountId, query.projectId)
        return readWorkflowCaseView(db, accountId, project, query.caseId)
      })
    }
  }
}
