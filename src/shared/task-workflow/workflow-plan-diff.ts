import { z } from 'zod'
import { structuredAgentSessionDigest as digest } from '../structured-agent-session-mutation'
import { boundedTaskCollection, TaskOpaqueRef } from '../task-execution/task-execution-primitives'
import { WorkflowPlanProposalSchema, type WorkflowPlanProposal } from './workflow-plan-proposal'

const taskFields = [
  'title',
  'requestedRole',
  'outputKind',
  'dependsOn',
  'acceptance',
  'maxAttempts'
] as const
const planFields = [
  'requestedLimits',
  'resourceSelectionRefs',
  'requiredCoverage',
  'knowledgeRequirements'
] as const
export const WorkflowPlanDiffSchema = z
  .strictObject({
    addedTaskRefs: boundedTaskCollection(TaskOpaqueRef, 32),
    removedTaskRefs: boundedTaskCollection(TaskOpaqueRef, 32),
    changedTasks: boundedTaskCollection(
      z.strictObject({
        taskRef: TaskOpaqueRef,
        fields: boundedTaskCollection(z.enum(taskFields), taskFields.length, 1)
      }),
      32
    ),
    changedPlanFields: boundedTaskCollection(z.enum(planFields), planFields.length)
  })
  .superRefine((diff, context) => {
    const refs = [
      ...diff.addedTaskRefs,
      ...diff.removedTaskRefs,
      ...diff.changedTasks.map((task) => task.taskRef)
    ]
    if (
      new Set(refs).size !== refs.length ||
      new Set(diff.changedPlanFields).size !== diff.changedPlanFields.length ||
      diff.changedTasks.some((task) => new Set(task.fields).size !== task.fields.length)
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_plan_diff_duplicate' })
    }
  })
export type WorkflowPlanDiff = z.infer<typeof WorkflowPlanDiffSchema>

function comparable(field: string, value: unknown) {
  if (Array.isArray(value) && ['dependsOn', 'resourceSelectionRefs'].includes(field)) {
    return [...value].sort()
  }
  if (field === 'knowledgeRequirements' && Array.isArray(value)) {
    return [...value].sort((a, b) =>
      a.sourceRef < b.sourceRef ? -1 : a.sourceRef > b.sourceRef ? 1 : 0
    )
  }
  return value
}

export function compareWorkflowPlans(
  current: WorkflowPlanProposal,
  previous: WorkflowPlanProposal | null
): WorkflowPlanDiff {
  const next = WorkflowPlanProposalSchema.parse(current)
  const before = previous === null ? null : WorkflowPlanProposalSchema.parse(previous)
  if (
    before &&
    (digest(next.binding) !== digest(before.binding) ||
      next.goalRef !== before.goalRef ||
      next.definitionDigest !== before.definitionDigest ||
      next.planRevision <= before.planRevision)
  ) {
    throw new Error('workflow_plan_diff_baseline_mismatch')
  }
  const oldTasks = new Map(before?.tasks.map((task) => [task.taskRef, task]) ?? [])
  const newTasks = new Map(next.tasks.map((task) => [task.taskRef, task]))
  const changedTasks: WorkflowPlanDiff['changedTasks'] = []
  for (const taskRef of [...newTasks.keys()].sort()) {
    const task = newTasks.get(taskRef)!
    const old = oldTasks.get(taskRef)
    if (!old) {
      continue
    }
    const fields = taskFields.filter(
      (field) =>
        digest({ value: comparable(field, task[field]) }) !==
        digest({ value: comparable(field, old[field]) })
    )
    if (fields.length) {
      changedTasks.push({ taskRef, fields })
    }
  }
  return WorkflowPlanDiffSchema.parse({
    addedTaskRefs: [...newTasks.keys()].filter((ref) => !oldTasks.has(ref)).sort(),
    removedTaskRefs: [...oldTasks.keys()].filter((ref) => !newTasks.has(ref)).sort(),
    changedTasks,
    changedPlanFields: before
      ? planFields.filter(
          (field) =>
            digest({ value: comparable(field, next[field]) }) !==
            digest({ value: comparable(field, before[field]) })
        )
      : []
  })
}
