import { z } from 'zod'
import { boundedTaskCollection, TaskEpoch } from './task-execution/task-execution-primitives'
import {
  WorkflowCompanyBindingSchema,
  WorkflowEmployeeBindingSchema,
  WorkflowProjectBindingSchema,
  WorkflowRoleSchema,
  WorkflowTeamBindingSchema
} from './task-workflow/workflow-bindings'

const ObjectId = z.string().uuid()
export const HiveWorkbenchObjectIdInputSchema = ObjectId.transform((id) => id.toLowerCase())
const Name = z.string().trim().min(1).max(160)
export const HiveWorkbenchPageQuerySchema = z.strictObject({
  after: HiveWorkbenchObjectIdInputSchema.optional(),
  limit: z.number().int().min(1).max(50).default(25)
})
export const HiveWorkbenchProjectsQuerySchema = HiveWorkbenchPageQuerySchema.extend({
  companyId: HiveWorkbenchObjectIdInputSchema
})
export const HiveWorkbenchCompanyCreateSchema = z.strictObject({
  requestId: HiveWorkbenchObjectIdInputSchema,
  name: Name
})
export const HiveWorkbenchProjectCreateSchema = z.strictObject({
  requestId: HiveWorkbenchObjectIdInputSchema,
  companyId: HiveWorkbenchObjectIdInputSchema,
  name: Name,
  workspaceSelector: z.string().min(1).max(512)
})
export const HiveWorkbenchEmployeeInputSchema = z.strictObject({
  role: WorkflowRoleSchema,
  name: Name,
  profileRef: z.literal('codex'),
  profileRevision: z.literal('codex:1')
})
export const HiveWorkbenchTeamConfigureSchema = z
  .strictObject({
    requestId: HiveWorkbenchObjectIdInputSchema,
    projectId: HiveWorkbenchObjectIdInputSchema,
    expectedRevision: TaskEpoch,
    employees: boundedTaskCollection(HiveWorkbenchEmployeeInputSchema, 4, 4)
  })
  .superRefine((input, context) => {
    if (new Set(input.employees.map((employee) => employee.role)).size !== 4) {
      context.addIssue({ code: 'custom', message: 'workflow_distinct_roles_required' })
    }
  })

export const HiveWorkbenchCompanySchema = z
  .strictObject({ id: ObjectId, name: Name, binding: WorkflowCompanyBindingSchema })
  .superRefine((company, context) => {
    if (company.id !== company.binding.companyRef) {
      context.addIssue({ code: 'custom', message: 'workflow_scope_mismatch' })
    }
  })
export const HiveWorkbenchProjectSchema = z
  .strictObject({
    id: ObjectId,
    companyId: ObjectId,
    name: Name,
    workspaceSelector: z.string().min(1).max(512),
    binding: WorkflowProjectBindingSchema
  })
  .superRefine((project, context) => {
    if (
      project.id !== project.binding.scope.projectRef ||
      project.companyId !== project.binding.scope.companyRef
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_scope_mismatch' })
    }
  })
export const HiveWorkbenchEmployeeSchema = z.strictObject({
  name: Name,
  binding: WorkflowEmployeeBindingSchema
})
export const HiveWorkbenchTeamSchema = z
  .strictObject({
    company: HiveWorkbenchCompanySchema,
    project: HiveWorkbenchProjectSchema,
    employees: boundedTaskCollection(HiveWorkbenchEmployeeSchema, 4),
    executionAvailability: z.strictObject({
      available: z.literal(false),
      reason: z.enum(['TEAM_NOT_CONFIGURED', 'EXECUTION_ISOLATION_UNAVAILABLE'])
    })
  })
  .superRefine((team, context) => {
    if (team.employees.length === 0) {
      if (
        team.company.id !== team.project.companyId ||
        team.executionAvailability.reason !== 'TEAM_NOT_CONFIGURED'
      ) {
        context.addIssue({ code: 'custom', message: 'workflow_scope_mismatch' })
      }
      return
    }
    const parsed = WorkflowTeamBindingSchema.safeParse({
      contractVersion: 1,
      kind: 'workflow.team-binding',
      company: team.company.binding,
      project: team.project.binding,
      employees: team.employees.map((employee) => employee.binding)
    })
    if (
      !parsed.success ||
      team.executionAvailability.reason !== 'EXECUTION_ISOLATION_UNAVAILABLE'
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_team_binding_invalid' })
    }
  })
export const HiveWorkbenchCompanyPageSchema = z.strictObject({
  items: boundedTaskCollection(HiveWorkbenchCompanySchema, 50),
  nextCursor: ObjectId.nullable()
})
export const HiveWorkbenchProjectPageSchema = z.strictObject({
  items: boundedTaskCollection(HiveWorkbenchProjectSchema, 50),
  nextCursor: ObjectId.nullable()
})

export type HiveWorkbenchPageQuery = z.input<typeof HiveWorkbenchPageQuerySchema>
export type HiveWorkbenchProjectsQuery = z.input<typeof HiveWorkbenchProjectsQuerySchema>
export type HiveWorkbenchCompanyCreate = z.infer<typeof HiveWorkbenchCompanyCreateSchema>
export type HiveWorkbenchProjectCreate = z.infer<typeof HiveWorkbenchProjectCreateSchema>
export type HiveWorkbenchTeamConfigure = z.infer<typeof HiveWorkbenchTeamConfigureSchema>
export type HiveWorkbenchCompany = z.infer<typeof HiveWorkbenchCompanySchema>
export type HiveWorkbenchProject = z.infer<typeof HiveWorkbenchProjectSchema>
export type HiveWorkbenchTeam = z.infer<typeof HiveWorkbenchTeamSchema>
export type HiveWorkbenchCompanyPage = z.infer<typeof HiveWorkbenchCompanyPageSchema>
export type HiveWorkbenchProjectPage = z.infer<typeof HiveWorkbenchProjectPageSchema>
export type HiveTeamWorkbenchApi = {
  listCompanies(query?: HiveWorkbenchPageQuery): Promise<HiveWorkbenchCompanyPage>
  createCompany(input: HiveWorkbenchCompanyCreate): Promise<HiveWorkbenchCompany>
  listProjects(query: HiveWorkbenchProjectsQuery): Promise<HiveWorkbenchProjectPage>
  createProject(input: HiveWorkbenchProjectCreate): Promise<HiveWorkbenchProject>
  getTeam(projectId: string): Promise<HiveWorkbenchTeam>
  configureTeam(input: HiveWorkbenchTeamConfigure): Promise<HiveWorkbenchTeam>
}
