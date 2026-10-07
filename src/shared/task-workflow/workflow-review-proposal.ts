import { z } from 'zod'
import { TaskProgressSummary } from '../task-execution/task-execution-primitives'
import { WorkflowCodeVersionSchema } from './workflow-evidence'

// A model's proposal is data. The original authenticated run and current Case authorize its consumption.
export const WorkflowReviewProposalSchema = z.strictObject({
  contractVersion: z.literal(1),
  kind: z.literal('workflow.review-proposal'),
  decision: z.enum(['approved', 'changes_requested', 'rejected']),
  summary: TaskProgressSummary.refine((value) => value.trim().length > 0),
  testedCodeVersion: WorkflowCodeVersionSchema
})
export type WorkflowReviewProposal = z.infer<typeof WorkflowReviewProposalSchema>
