import { z } from 'zod'
import {
  WorkflowCompanyBindingSchema,
  WorkflowEmployeeBindingSchema,
  WorkflowProjectBindingSchema,
  WorkflowTeamBindingSchema
} from './workflow-bindings'
import { WorkflowDefinitionSchema } from './workflow-definition'
import { WorkflowPlanProposalSchema } from './workflow-plan-proposal'
import {
  WorkflowDeploymentApprovalSchema,
  WorkflowHandoffSchema,
  WorkflowReviewSchema,
  WorkflowSharedEventSchema
} from './workflow-evidence'

export const WorkflowSchemas = {
  CompanyBinding: WorkflowCompanyBindingSchema,
  ProjectBinding: WorkflowProjectBindingSchema,
  EmployeeBinding: WorkflowEmployeeBindingSchema,
  TeamBinding: WorkflowTeamBindingSchema,
  WorkflowDefinition: WorkflowDefinitionSchema,
  PlanProposal: WorkflowPlanProposalSchema,
  Handoff: WorkflowHandoffSchema,
  Review: WorkflowReviewSchema,
  DeploymentApproval: WorkflowDeploymentApprovalSchema,
  SharedEvent: WorkflowSharedEventSchema
}

export function taskWorkflowJsonSchema() {
  const definitions = Object.fromEntries(
    Object.entries(WorkflowSchemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { target: 'draft-2020-12' })
    ])
  )
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:hive:task-workflow:1',
    $defs: definitions,
    oneOf: Object.keys(definitions).map((name) => ({ $ref: `#/$defs/${name}` }))
  }
}
