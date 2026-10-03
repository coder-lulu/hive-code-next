import { z } from 'zod'
import {
  boundedTaskCollection,
  TaskEpoch,
  TaskOpaqueRef,
  TaskOwnerScopeSchema
} from '../task-execution/task-execution-primitives'

export const WORKFLOW_CONTRACT_VERSION = 1
export const WorkflowRoleSchema = z.enum(['product', 'developer', 'tester', 'ops'])
export const WorkflowScopeSchema = z.strictObject({
  companyRef: TaskOpaqueRef,
  projectRef: TaskOpaqueRef
})
export const WorkflowReferenceFields = {
  workflowRef: TaskOpaqueRef,
  workflowRevision: TaskEpoch
}
export const WorkflowRunBindingSchema = z.strictObject({
  scope: WorkflowScopeSchema,
  ...WorkflowReferenceFields,
  workflowRunRef: TaskOpaqueRef
})

// These are stored mappings produced by Hive, not caller-supplied authorization grants.
export const WorkflowCompanyBindingSchema = z.strictObject({
  contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
  kind: z.literal('workflow.company-binding'),
  companyRef: TaskOpaqueRef,
  ownerScope: TaskOwnerScopeSchema,
  ownerAccountRef: TaskOpaqueRef,
  ownerActorRef: TaskOpaqueRef,
  bindingRevision: TaskEpoch
})
export const WorkflowProjectBindingSchema = z.strictObject({
  contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
  kind: z.literal('workflow.project-binding'),
  scope: WorkflowScopeSchema,
  hiveWorkspaceRef: TaskOpaqueRef,
  bindingRevision: TaskEpoch
})
export const WorkflowEmployeeBindingSchema = z.strictObject({
  contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
  kind: z.literal('workflow.employee-binding'),
  scope: WorkflowScopeSchema,
  employeeRef: TaskOpaqueRef,
  role: WorkflowRoleSchema,
  adapterType: z.literal('hive_runtime'),
  executor: z.literal('codex'),
  profileRef: TaskOpaqueRef,
  profileRevision: TaskOpaqueRef,
  bindingRevision: TaskEpoch
})

export const WorkflowTeamBindingSchema = z
  .strictObject({
    contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
    kind: z.literal('workflow.team-binding'),
    company: WorkflowCompanyBindingSchema,
    project: WorkflowProjectBindingSchema,
    employees: boundedTaskCollection(WorkflowEmployeeBindingSchema, 4, 4)
  })
  .superRefine((team, context) => {
    const scope = team.project.scope
    const scoped =
      team.company.companyRef === scope.companyRef &&
      team.employees.every(
        (employee) =>
          employee.scope.companyRef === scope.companyRef &&
          employee.scope.projectRef === scope.projectRef
      )
    if (!scoped) {
      context.addIssue({ code: 'custom', message: 'workflow_scope_mismatch' })
    }
    if (
      new Set(team.employees.map((employee) => employee.employeeRef)).size !== 4 ||
      new Set(team.employees.map((employee) => employee.role)).size !== 4
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_distinct_roles_required' })
    }
  })

export type WorkflowRunBinding = z.infer<typeof WorkflowRunBindingSchema>
export type WorkflowTeamBinding = z.infer<typeof WorkflowTeamBindingSchema>
