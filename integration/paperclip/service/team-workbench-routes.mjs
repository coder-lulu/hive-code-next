import { z } from 'zod'
import {
  HiveWorkbenchCompanyCreateSchema,
  HiveWorkbenchObjectIdInputSchema,
  HiveWorkbenchPageQuerySchema,
  HiveWorkbenchProjectsQuerySchema,
  HiveWorkbenchTeamConfigureSchema
} from '../../../src/shared/hive-team-workbench.ts'
import { WorkbenchProjectBindingCreateSchema } from './team-workbench-repository.mjs'
import { refuseWorkbench } from './team-workbench-repository-records.mjs'

export const WORKBENCH_PATHS = Object.freeze([
  '/hive/workbench/companies/list',
  '/hive/workbench/companies/create',
  '/hive/workbench/projects/list',
  '/hive/workbench/projects/create',
  '/hive/workbench/team/read',
  '/hive/workbench/team/configure'
])
const TeamRead = z.strictObject({ projectId: HiveWorkbenchObjectIdInputSchema })

/** The authenticated Hive facade supplies account identity and the validated workspace binding. */
export function handleTeamWorkbenchRequest(repository, accountId, path, body) {
  switch (path) {
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
