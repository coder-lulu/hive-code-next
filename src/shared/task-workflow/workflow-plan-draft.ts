import { z } from 'zod'
import { structuredAgentSessionDigest as digest } from '../structured-agent-session-mutation'
import {
  boundedTaskCollection,
  TaskDigest,
  TaskOpaqueRef
} from '../task-execution/task-execution-primitives'
import { WORKFLOW_CONTRACT_VERSION } from './workflow-bindings'
import { WorkflowRoleExecutionSchema } from './workflow-evidence'
import { WorkflowNativeOutcomeAssetSchema } from './workflow-native-outcome'
import { WorkflowPlanIntentSchema } from './workflow-plan-intent'
import { WorkflowPlanProposalSchema } from './workflow-plan-proposal'
import {
  inspectWorkflowPlanProposal,
  WorkflowPlanValidationRefusalSchema
} from './workflow-plan-validation'

const InspectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('validated'),
    proposal: WorkflowPlanProposalSchema,
    capabilityGaps: boundedTaskCollection(
      z.strictObject({
        capability: z.enum([
          'task_graph_dispatch',
          'resource_loading',
          'hard_budget_enforcement',
          'knowledge_access'
        ]),
        blocking: z.boolean(),
        sourceRef: TaskOpaqueRef.optional()
      }),
      19
    )
  }),
  z.strictObject({
    kind: z.literal('rejected'),
    reason: WorkflowPlanValidationRefusalSchema,
    taskRef: TaskOpaqueRef.optional()
  }),
  z.strictObject({ kind: z.literal('unavailable'), reason: z.literal('plan_artifact_missing') })
])

// This transaction projection preserves source identity; it is not proof of raw artifact bytes.
export const WorkflowPlanDraftSchema = z
  .strictObject({
    contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
    kind: z.literal('workflow.plan-draft'),
    draftRef: TaskOpaqueRef,
    intent: WorkflowPlanIntentSchema,
    producer: WorkflowRoleExecutionSchema,
    outcomeVersion: WorkflowNativeOutcomeAssetSchema.shape.version,
    sourceInputDigest: TaskDigest,
    artifact: WorkflowNativeOutcomeAssetSchema.shape.version.optional(),
    inspection: InspectionSchema
  })
  .superRefine((draft, context) => {
    if (
      draft.producer.role !== 'product' ||
      draft.producer.employeeRef !== draft.intent.employeeRef ||
      digest(draft.producer.task) !== digest(draft.intent.sourceTask) ||
      (draft.inspection.kind === 'unavailable') !== (draft.artifact === undefined)
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_plan_draft_source_mismatch' })
    }
    if (draft.inspection.kind === 'validated') {
      const expected = inspectWorkflowPlanProposal(draft.inspection.proposal, draft.intent.facts)
      if (expected.kind !== 'validated' || digest(expected) !== digest(draft.inspection)) {
        context.addIssue({ code: 'custom', message: 'workflow_plan_draft_inspection_mismatch' })
      }
    }
  })

export type WorkflowPlanDraft = z.infer<typeof WorkflowPlanDraftSchema>
