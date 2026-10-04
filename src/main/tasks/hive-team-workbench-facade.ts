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
  HiveWorkbenchTeamSchema,
  type HiveTeamWorkbenchApi,
  type HiveWorkbenchCompany
} from '../../shared/hive-team-workbench'
import { TaskOpaqueRef } from '../../shared/task-execution/task-execution-primitives'
import { refuseTaskExecution } from './task-execution-error'

export type HiveTaskWorkspaceProof = {
  workspaceRef: string
  assertCurrent(): void
}
export type HiveTaskRequestContext = {
  accountRef: string
  assertCurrent(): void
  request(path: string, body?: unknown): Promise<unknown>
}

export function createHiveTeamWorkbenchFacade(options: {
  context(): Promise<HiveTaskRequestContext>
  validateWorkspace(selector: string): Promise<HiveTaskWorkspaceProof>
}): HiveTeamWorkbenchApi {
  const assertCompany = (company: HiveWorkbenchCompany, caller: HiveTaskRequestContext) => {
    const binding = company.binding
    if (
      binding.ownerAccountRef !== caller.accountRef ||
      binding.ownerActorRef !== `actor:${caller.accountRef.slice('account:'.length)}` ||
      binding.ownerScope.kind !== 'personalTenant' ||
      binding.ownerScope.tenantRef !== caller.accountRef
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
  }
  return {
    async listCompanies(rawQuery = {}) {
      const query = HiveWorkbenchPageQuerySchema.parse(rawQuery)
      const caller = await options.context()
      const result = HiveWorkbenchCompanyPageSchema.parse(
        await caller.request('/hive/workbench/companies/list', query)
      )
      result.items.forEach((company) => assertCompany(company, caller))
      return result
    },
    async createCompany(rawInput) {
      const input = HiveWorkbenchCompanyCreateSchema.parse(rawInput)
      const caller = await options.context()
      const result = HiveWorkbenchCompanySchema.parse(
        await caller.request('/hive/workbench/companies/create', input)
      )
      assertCompany(result, caller)
      if (result.name !== input.name) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return result
    },
    async listProjects(rawQuery) {
      const query = HiveWorkbenchProjectsQuerySchema.parse(rawQuery)
      const caller = await options.context()
      const result = HiveWorkbenchProjectPageSchema.parse(
        await caller.request('/hive/workbench/projects/list', query)
      )
      if (result.items.some((project) => project.companyId !== query.companyId)) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return result
    },
    async createProject(rawInput) {
      const input = HiveWorkbenchProjectCreateSchema.parse(rawInput)
      const caller = await options.context()
      const workspace = await options.validateWorkspace(input.workspaceSelector)
      const hiveWorkspaceRef = TaskOpaqueRef.parse(workspace.workspaceRef)
      workspace.assertCurrent()
      caller.assertCurrent()
      const result = HiveWorkbenchProjectSchema.parse(
        await caller.request('/hive/workbench/projects/create', { ...input, hiveWorkspaceRef })
      )
      workspace.assertCurrent()
      if (
        result.companyId !== input.companyId ||
        result.name !== input.name ||
        result.workspaceSelector !== input.workspaceSelector ||
        result.binding.hiveWorkspaceRef !== hiveWorkspaceRef
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return result
    },
    async getTeam(rawProjectId) {
      const projectId = HiveWorkbenchObjectIdInputSchema.parse(rawProjectId)
      const caller = await options.context()
      const result = HiveWorkbenchTeamSchema.parse(
        await caller.request('/hive/workbench/team/read', { projectId })
      )
      assertCompany(result.company, caller)
      if (result.project.id !== projectId) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return result
    },
    async configureTeam(rawInput) {
      const input = HiveWorkbenchTeamConfigureSchema.parse(rawInput)
      const caller = await options.context()
      const result = HiveWorkbenchTeamSchema.parse(
        await caller.request('/hive/workbench/team/configure', input)
      )
      assertCompany(result.company, caller)
      if (
        result.project.id !== input.projectId ||
        result.project.binding.bindingRevision !== input.expectedRevision + 1 ||
        input.employees.some((employee) => {
          const configured = result.employees.find((entry) => entry.binding.role === employee.role)
          return (
            !configured ||
            configured.name !== employee.name ||
            configured.binding.profileRef !== employee.profileRef ||
            configured.binding.profileRevision !== employee.profileRevision
          )
        })
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return result
    }
  }
}
