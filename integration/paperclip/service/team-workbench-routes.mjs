import { z } from 'zod'
import {
  HiveWorkflowPlanQuerySchema,
  HiveWorkflowPlanApplySchema
} from '../../../src/shared/hive-workflow-plan-application.ts'
import {
  HiveWorkflowCaseStartSchema,
  HiveWorkflowCaseRunReadSchema
} from '../../../src/shared/hive-workflow-case-runs.ts'
import {
  HiveWorkbenchCompanyCreateSchema,
  HiveWorkbenchObjectIdInputSchema,
  HiveWorkbenchPageQuerySchema,
  HiveWorkbenchProjectsQuerySchema,
  HiveWorkbenchTeamConfigureSchema
} from '../../../src/shared/hive-team-workbench.ts'
import { WorkbenchProjectBindingCreateSchema } from './team-workbench-repository.mjs'
import { refuseWorkbench } from './team-workbench-repository-records.mjs'
import {
  HiveWorkflowListQuerySchema,
  HiveWorkflowReadQuerySchema,
  HiveWorkflowSaveSchema
} from '../../../src/shared/hive-task-workflows.ts'
import {
  HiveWorkflowCaseCreateSchema,
  HiveWorkflowCaseListQuerySchema,
  HiveWorkflowCaseReadQuerySchema
} from '../../../src/shared/hive-workflow-cases.ts'

export const WORKBENCH_PATHS = Object.freeze([
  '/hive/workbench/plans/read',
  '/hive/workbench/plans/apply',
  '/hive/workbench/companies/list',
  '/hive/workbench/companies/create',
  '/hive/workbench/projects/list',
  '/hive/workbench/projects/create',
  '/hive/workbench/team/read',
  '/hive/workbench/team/configure',
  '/hive/workbench/workflows/list',
  '/hive/workbench/workflows/read',
  '/hive/workbench/workflows/save',
  '/hive/workbench/cases/create',
  '/hive/workbench/cases/list',
  '/hive/workbench/cases/read',
  '/hive/workbench/cases/start',
  '/hive/workbench/cases/runs',
  '/hive/workbench/cases/run-read'
])
const TeamRead = z.strictObject({ projectId: HiveWorkbenchObjectIdInputSchema })

/** The authenticated Hive facade supplies account identity and the validated workspace binding. */
export function handleTeamWorkbenchRequest(repository, accountId, path, body) {
  switch (path) {
    case '/hive/workbench/plans/read':
      return repository.getWorkflowPlanApplication(
        accountId,
        HiveWorkflowPlanQuerySchema.parse(body)
      )
    case '/hive/workbench/plans/apply':
      return repository.applyWorkflowPlan(accountId, HiveWorkflowPlanApplySchema.parse(body))
    case '/hive/workbench/cases/run-read':
      return repository.getWorkflowCaseRunAdmission(
        accountId,
        HiveWorkflowCaseRunReadSchema.parse(body)
      )
    case '/hive/workbench/cases/start':
      return repository.startWorkflowCase(accountId, HiveWorkflowCaseStartSchema.parse(body))
    case '/hive/workbench/cases/runs':
      return repository.getWorkflowCaseRuns(accountId, HiveWorkflowCaseReadQuerySchema.parse(body))
    case '/hive/workbench/cases/create':
      return repository.createWorkflowCase(accountId, HiveWorkflowCaseCreateSchema.parse(body))
    case '/hive/workbench/cases/list':
      return repository.listWorkflowCases(accountId, HiveWorkflowCaseListQuerySchema.parse(body))
    case '/hive/workbench/cases/read':
      return repository.getWorkflowCase(accountId, HiveWorkflowCaseReadQuerySchema.parse(body))
    case '/hive/workbench/workflows/list':
      return repository.listWorkflows(accountId, HiveWorkflowListQuerySchema.parse(body))
    case '/hive/workbench/workflows/read':
      return repository.getWorkflow(accountId, HiveWorkflowReadQuerySchema.parse(body))
    case '/hive/workbench/workflows/save':
      return repository.saveWorkflow(accountId, HiveWorkflowSaveSchema.parse(body))
    case '/hive/workbench/companies/list':
      return repository.listCompanies(accountId, HiveWorkbenchPageQuerySchema.parse(body))
    case '/hive/workbench/companies/create':
      return repository.createCompany(accountId, HiveWorkbenchCompanyCreateSchema.parse(body))
    case '/hive/workbench/projects/list':
      return repository.listProjects(accountId, HiveWorkbenchProjectsQuerySchema.parse(body))
    case '/hive/workbench/projects/create':
      return repository.createProject(accountId, WorkbenchProjectBindingCreateSchema.parse(body))
    case '/hive/workbench/team/read':
      return repository.getTeam(accountId, TeamRead.parse(body).projectId)
    case '/hive/workbench/team/configure':
      return repository.configureTeam(accountId, HiveWorkbenchTeamConfigureSchema.parse(body))
    default:
      return refuseWorkbench('FORBIDDEN')
  }
}
