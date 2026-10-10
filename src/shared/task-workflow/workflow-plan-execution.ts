import { z } from 'zod'
import {
  boundedTaskCollection,
  TaskDigest,
  TaskEpoch,
  TaskOpaqueRef,
  TaskRefSchema
} from '../task-execution/task-execution-primitives'
import { WorkflowArtifactVersionSchema, WorkflowRoleExecutionSchema } from './workflow-evidence'

export const WorkflowPlanExecutionSchema = z
  .strictObject({
    graphRef: z.string().uuid(),
    applicationRef: z.string().uuid(),
    planRevision: TaskEpoch,
    draftDigest: TaskDigest,
    proposalDigest: TaskDigest,
    proposalTaskRef: TaskOpaqueRef,
    sourceTask: TaskRefSchema,
    dependencyOutcomes: boundedTaskCollection(
      z.strictObject({
        proposalTaskRef: TaskOpaqueRef,
        producer: WorkflowRoleExecutionSchema,
        outcomeRef: TaskOpaqueRef,
        outcomeVersion: WorkflowArtifactVersionSchema
      }),
      32
    )
  })
  .superRefine((plan, context) => {
    const dependencies = plan.dependencyOutcomes
    if (
      new Set(dependencies.map((item) => item.proposalTaskRef)).size !== dependencies.length ||
      new Set(dependencies.map((item) => item.outcomeRef)).size !== dependencies.length ||
      dependencies.some(
        (item) =>
          item.proposalTaskRef === plan.proposalTaskRef ||
          item.producer.task.spaceId !== plan.sourceTask.spaceId
      )
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_plan_execution_dependency_mismatch' })
    }
  })

export type WorkflowPlanExecution = z.infer<typeof WorkflowPlanExecutionSchema>
