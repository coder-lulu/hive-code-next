import { z } from 'zod'
import { structuredAgentSessionDigest as digest } from '../structured-agent-session-mutation'
import {
  boundedTaskCollection,
  TaskDigest,
  TaskEpoch,
  TaskOpaqueRef
} from '../task-execution/task-execution-primitives'
import { WorkflowRoleSchema, WorkflowRunBindingSchema } from './workflow-bindings'
import {
  WORKFLOW_PLAN_LIMITS,
  WorkflowPlanProposalRefusalSchema,
  WorkflowPlanProposalSchema,
  workflowPlanProposalRefusal,
  type WorkflowPlanProposal
} from './workflow-plan-proposal'

// Callers must derive these facts from authenticated storage, never the model or a request body.
export const WorkflowPlanValidationFactsSchema = z.strictObject({
  binding: WorkflowRunBindingSchema,
  definitionDigest: TaskDigest,
  goalRef: TaskOpaqueRef,
  planRevision: TaskEpoch,
  authorizedRoles: boundedTaskCollection(WorkflowRoleSchema, 4, 1).refine(
    (roles) => new Set(roles).size === roles.length
  ),
  limits: z.strictObject({
    maxTasks: z.number().int().min(1).max(WORKFLOW_PLAN_LIMITS.tasks),
    maxParallelism: z.number().int().min(1).max(4),
    maxDurationMs: z.number().int().min(1000).max(86_400_000),
    maxAttempts: z.number().int().min(1).max(3)
  })
})
export type WorkflowPlanValidationFacts = z.infer<typeof WorkflowPlanValidationFactsSchema>
export const WorkflowPlanValidationRefusalSchema = z.enum([
  ...WorkflowPlanProposalRefusalSchema.options,
  'plan_policy_invalid',
  'plan_target_mismatch',
  'plan_limits_exceeded',
  'plan_role_unavailable',
  'plan_json_invalid',
  'plan_request_too_large'
])
export type WorkflowPlanValidationRefusal = z.infer<typeof WorkflowPlanValidationRefusalSchema>
export type WorkflowPlanCapabilityGap = {
  capability:
    | 'task_graph_dispatch'
    | 'resource_loading'
    | 'hard_budget_enforcement'
    | 'knowledge_access'
  blocking: boolean
  sourceRef?: string
}
export type WorkflowPlanValidationResult =
  | { kind: 'rejected'; reason: WorkflowPlanValidationRefusal; taskRef?: string }
  | {
      kind: 'validated'
      proposal: WorkflowPlanProposal
      capabilityGaps: WorkflowPlanCapabilityGap[]
    }

/** Checks data against fixed host facts; neither this result nor its inputs grant authority. */
export function inspectWorkflowPlanProposal(
  value: unknown,
  rawFacts: WorkflowPlanValidationFacts
): WorkflowPlanValidationResult {
  const factsResult = WorkflowPlanValidationFactsSchema.safeParse(rawFacts)
  if (!factsResult.success) {
    return { kind: 'rejected', reason: 'plan_policy_invalid' }
  }
  const parsed = WorkflowPlanProposalSchema.safeParse(value)
  if (!parsed.success) {
    return { kind: 'rejected', reason: workflowPlanProposalRefusal(value) ?? 'plan_invalid' }
  }
  const proposal = parsed.data
  const facts = factsResult.data
  if (
    digest(proposal.binding) !== digest(facts.binding) ||
    proposal.definitionDigest !== facts.definitionDigest ||
    proposal.goalRef !== facts.goalRef ||
    proposal.planRevision !== facts.planRevision
  ) {
    return { kind: 'rejected', reason: 'plan_target_mismatch' }
  }
  const limits = facts.limits
  if (
    proposal.tasks.length > limits.maxTasks ||
    proposal.requestedLimits.maxParallelism > limits.maxParallelism ||
    proposal.requestedLimits.maxDurationMs > limits.maxDurationMs
  ) {
    return { kind: 'rejected', reason: 'plan_limits_exceeded' }
  }
  for (const task of proposal.tasks) {
    if (!facts.authorizedRoles.includes(task.requestedRole)) {
      return { kind: 'rejected', reason: 'plan_role_unavailable', taskRef: task.taskRef }
    }
    if (task.maxAttempts > limits.maxAttempts) {
      return { kind: 'rejected', reason: 'plan_limits_exceeded', taskRef: task.taskRef }
    }
  }
  // General business DAG dispatch, resources, knowledge and hard budgets have no consumers yet.
  const capabilityGaps: WorkflowPlanCapabilityGap[] = [
    { capability: 'task_graph_dispatch', blocking: true }
  ]
  if (proposal.resourceSelectionRefs) {
    capabilityGaps.push({ capability: 'resource_loading', blocking: true })
  }
  if (proposal.requestedLimits.budget) {
    capabilityGaps.push({ capability: 'hard_budget_enforcement', blocking: true })
  }
  for (const requirement of proposal.knowledgeRequirements ?? []) {
    capabilityGaps.push({
      capability: 'knowledge_access',
      blocking: requirement.required,
      sourceRef: requirement.sourceRef
    })
  }
  return { kind: 'validated', proposal, capabilityGaps }
}

/** Enforce the wire byte limit before parsing JSON or validating any proposal members. */
export function inspectWorkflowPlanProposalJson(
  text: string,
  facts: WorkflowPlanValidationFacts
): WorkflowPlanValidationResult {
  if (typeof text !== 'string') {
    return { kind: 'rejected', reason: 'plan_json_invalid' }
  }
  if (
    text.length > WORKFLOW_PLAN_LIMITS.maxRequestBytes ||
    new TextEncoder().encode(text).byteLength > WORKFLOW_PLAN_LIMITS.maxRequestBytes
  ) {
    return { kind: 'rejected', reason: 'plan_request_too_large' }
  }
  if (!text.isWellFormed()) {
    return { kind: 'rejected', reason: 'plan_json_invalid' }
  }
  let value: unknown
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return { kind: 'rejected', reason: 'plan_json_invalid' }
  }
  return inspectWorkflowPlanProposal(value, facts)
}
