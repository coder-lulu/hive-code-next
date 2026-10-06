import { z } from 'zod'
import { TaskExecutionReconcileSchema } from '../task-execution/task-execution-observation'

export const WorkflowNativeOutcomeQuerySchema = TaskExecutionReconcileSchema.omit({
  kind: true
}).extend({
  kind: z.literal('workflow.outcome.read')
})
export const WorkflowNativeCommandsQuerySchema = TaskExecutionReconcileSchema.omit({
  kind: true
}).extend({
  kind: z.literal('workflow.commands.read'),
  artifactRef: z
    .string()
    .length(73)
    .regex(/^artifact:[a-f0-9]{64}$/)
})
export type WorkflowNativeOutcomeQuery = z.infer<typeof WorkflowNativeOutcomeQuerySchema>
export type WorkflowNativeCommandsQuery = z.infer<typeof WorkflowNativeCommandsQuerySchema>
