import { z } from 'zod'
import {
  boundedTaskCollection,
  TaskCounter,
  TaskCoverage,
  TaskDigest,
  TaskEpoch,
  TaskOpaqueRef,
  TaskProgressSummary
} from '../task-execution/task-execution-primitives'
import {
  WORKFLOW_CONTRACT_VERSION,
  WorkflowRoleSchema,
  WorkflowRunBindingSchema
} from './workflow-bindings'
import { WorkflowStageSchema } from './workflow-definition'

export const WORKFLOW_PLAN_LIMITS = {
  tasks: 32,
  dependencies: 32,
  acceptance: 16,
  depth: 8,
  maxRequestBytes: 128 * 1024
} as const

export type WorkflowPlanProposalRefusal =
  | 'plan_invalid'
  | 'plan_duplicate_task'
  | 'plan_unknown_dependency'
  | 'plan_duplicate_dependency'
  | 'plan_dependency_cycle'
  | 'plan_depth_exceeded'
  | 'plan_output_mismatch'
  | 'plan_resource_coverage_required'
  | 'plan_duplicate_resource'
  | 'plan_duplicate_knowledge'

const NonblankSummary = TaskProgressSummary.min(1).regex(/\S/)
const PlanTaskSchema = z.strictObject({
  taskRef: TaskOpaqueRef,
  title: NonblankSummary,
  requestedRole: WorkflowRoleSchema,
  outputKind: WorkflowStageSchema.shape.outputKind,
  dependsOn: boundedTaskCollection(TaskOpaqueRef, WORKFLOW_PLAN_LIMITS.dependencies),
  acceptance: boundedTaskCollection(NonblankSummary, WORKFLOW_PLAN_LIMITS.acceptance, 1),
  maxAttempts: z.number().int().min(1).max(3)
})
const PlanProposalInputSchema = z.strictObject({
  contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
  kind: z.literal('workflow.plan-proposal'),
  binding: WorkflowRunBindingSchema,
  definitionDigest: TaskDigest,
  goalRef: TaskOpaqueRef,
  planRevision: TaskEpoch,
  tasks: boundedTaskCollection(PlanTaskSchema, WORKFLOW_PLAN_LIMITS.tasks, 1),
  requestedLimits: z.strictObject({
    maxParallelism: z.number().int().min(1).max(4),
    maxDurationMs: z.number().int().min(1000).max(86_400_000),
    budget: z
      .strictObject({
        costMicros: TaskCounter.min(1),
        currency: z
          .string()
          .length(3)
          .regex(/^[A-Z]{3}(?![\s\S])/)
      })
      .optional()
  }),
  resourceSelectionRefs: boundedTaskCollection(TaskOpaqueRef, 16, 1).optional(),
  requiredCoverage: TaskCoverage.optional(),
  knowledgeRequirements: boundedTaskCollection(
    z.strictObject({ sourceRef: TaskOpaqueRef, required: z.boolean() }),
    16,
    1
  ).optional()
})
type PlanProposal = z.infer<typeof PlanProposalInputSchema>

function taskGraphRefusal(proposal: PlanProposal): WorkflowPlanProposalRefusal | null {
  const tasks = new Map(proposal.tasks.map((task) => [task.taskRef, task]))
  if (tasks.size !== proposal.tasks.length) {
    return 'plan_duplicate_task'
  }
  const dependents = new Map<string, string[]>()
  const remaining = new Map<string, number>()
  const depth = new Map<string, number>()
  const ready: string[] = []
  for (const task of tasks.values()) {
    if (new Set(task.dependsOn).size !== task.dependsOn.length) {
      return 'plan_duplicate_dependency'
    }
    if (task.dependsOn.some((ref) => !tasks.has(ref))) {
      return 'plan_unknown_dependency'
    }
    if (
      task.outputKind !==
      {
        product: 'requirements',
        developer: 'code',
        tester: 'test_report',
        ops: 'release_plan'
      }[task.requestedRole]
    ) {
      return 'plan_output_mismatch'
    }
    remaining.set(task.taskRef, task.dependsOn.length)
    depth.set(task.taskRef, 1)
    if (!task.dependsOn.length) {
      ready.push(task.taskRef)
    }
    for (const ref of task.dependsOn) {
      const children = dependents.get(ref) ?? []
      children.push(task.taskRef)
      dependents.set(ref, children)
    }
  }
  for (let index = 0; index < ready.length; index++) {
    const ref = ready[index]
    const taskDepth = depth.get(ref) ?? 1
    if (taskDepth > WORKFLOW_PLAN_LIMITS.depth) {
      return 'plan_depth_exceeded'
    }
    for (const child of dependents.get(ref) ?? []) {
      depth.set(child, Math.max(depth.get(child) ?? 1, taskDepth + 1))
      const outstanding = (remaining.get(child) ?? 0) - 1
      remaining.set(child, outstanding)
      if (outstanding === 0) {
        ready.push(child)
      }
    }
  }
  return ready.length === tasks.size ? null : 'plan_dependency_cycle'
}

function proposalRefusal(proposal: PlanProposal): WorkflowPlanProposalRefusal | null {
  const graphReason = taskGraphRefusal(proposal)
  if (graphReason) {
    return graphReason
  }
  if (Boolean(proposal.resourceSelectionRefs) !== Boolean(proposal.requiredCoverage)) {
    return 'plan_resource_coverage_required'
  }
  if (
    proposal.resourceSelectionRefs &&
    new Set(proposal.resourceSelectionRefs).size !== proposal.resourceSelectionRefs.length
  ) {
    return 'plan_duplicate_resource'
  }
  if (
    proposal.knowledgeRequirements &&
    new Set(proposal.knowledgeRequirements.map((requirement) => requirement.sourceRef)).size !==
      proposal.knowledgeRequirements.length
  ) {
    return 'plan_duplicate_knowledge'
  }
  return null
}

// Proposal validity does not authorize adoption, resource loading or execution.
export const WorkflowPlanProposalSchema = PlanProposalInputSchema.superRefine(
  (proposal, context) => {
    const reason = proposalRefusal(proposal)
    if (reason) {
      context.addIssue({ code: 'custom', message: reason })
    }
  }
)

export function workflowPlanProposalRefusal(value: unknown): WorkflowPlanProposalRefusal | null {
  const parsed = PlanProposalInputSchema.safeParse(value)
  return parsed.success ? proposalRefusal(parsed.data) : 'plan_invalid'
}

export type WorkflowPlanProposal = z.infer<typeof WorkflowPlanProposalSchema>
