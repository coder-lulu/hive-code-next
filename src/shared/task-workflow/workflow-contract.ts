import { z } from 'zod'
import {
  WorkflowCompanyBindingSchema,
  WorkflowEmployeeBindingSchema,
  WorkflowProjectBindingSchema,
  WorkflowTeamBindingSchema
} from './workflow-bindings'
import { WorkflowDefinitionSchema } from './workflow-definition'
import { WorkflowPlanProposalSchema } from './workflow-plan-proposal'
import { WorkflowPlanIntentSchema } from './workflow-plan-intent'
import { WorkflowPlanDraftSchema } from './workflow-plan-draft'
import { WorkflowPlanDiffSchema } from './workflow-plan-diff'
import {
  HiveWorkflowPlanQuerySchema,
  HiveWorkflowPlanApplySchema,
  HiveWorkflowPlanApplicationReceiptSchema,
  HiveWorkflowPlanApplicationViewSchema,
  HiveWorkflowPlanApplyReplySchema
} from '../hive-workflow-plan-application'
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
  PlanIntent: WorkflowPlanIntentSchema,
  PlanDraft: WorkflowPlanDraftSchema,
  PlanDiff: WorkflowPlanDiffSchema,
  PlanApplicationQuery: HiveWorkflowPlanQuerySchema,
  PlanApplyRequest: HiveWorkflowPlanApplySchema,
  PlanApplyReceipt: HiveWorkflowPlanApplicationReceiptSchema,
  PlanApplicationView: HiveWorkflowPlanApplicationViewSchema,
  PlanApplyReply: HiveWorkflowPlanApplyReplySchema,
  Handoff: WorkflowHandoffSchema,
  Review: WorkflowReviewSchema,
  DeploymentApproval: WorkflowDeploymentApprovalSchema,
  SharedEvent: WorkflowSharedEventSchema
}

export function taskWorkflowJsonSchema() {
  const definitions = Object.fromEntries(
    Object.entries(WorkflowSchemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, {
        target: 'draft-2020-12',
        io: name === 'PlanApplicationQuery' || name === 'PlanApplyRequest' ? 'input' : 'output'
      })
    ])
  )
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:hive:task-workflow:1',
    $defs: definitions,
    oneOf: Object.keys(definitions).map((name) => ({ $ref: `#/$defs/${name}` }))
  }
}
