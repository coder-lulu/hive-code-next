import { z } from 'zod'
import { TaskOpaqueRef, TaskTimestamp } from './task-execution/task-execution-primitives'

// Read-only facts from the original Case event log; they grant no start or approval authority.
export const HiveWorkflowCaseExecutionNoticeSchema = z.strictObject({
  kind: z.literal('workflow.case-execution-notice'),
  eventRef: z.string().uuid(),
  stageRef: TaskOpaqueRef,
  causeRunId: z.string().uuid(),
  reason: z.enum([
    'native_not_started',
    'deadline_exceeded',
    'attempts_exhausted',
    'context_unavailable',
    'input_limit',
    'unsupported_graph'
  ]),
  recordedAt: TaskTimestamp
})
export type HiveWorkflowCaseExecutionNotice = z.infer<typeof HiveWorkflowCaseExecutionNoticeSchema>
