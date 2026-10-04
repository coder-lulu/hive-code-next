import { z } from 'zod'
import {
  boundedTaskCollection,
  TaskOpaqueRef,
  TaskProgressSummary
} from '../task-execution/task-execution-primitives'
import {
  WORKFLOW_CONTRACT_VERSION,
  WorkflowReferenceFields,
  WorkflowRoleSchema,
  WorkflowScopeSchema
} from './workflow-bindings'

export const WORKFLOW_STAGE_LIMITS = {
  stages: 32,
  dependencies: 32,
  acceptanceCriteria: 16
} as const

export const WorkflowStageSchema = z.strictObject({
  stageRef: TaskOpaqueRef,
  role: WorkflowRoleSchema,
  outputKind: z.enum(['requirements', 'code', 'test_report', 'release_plan']),
  dependsOn: boundedTaskCollection(TaskOpaqueRef, WORKFLOW_STAGE_LIMITS.dependencies),
  acceptanceCriteria: boundedTaskCollection(
    TaskProgressSummary,
    WORKFLOW_STAGE_LIMITS.acceptanceCriteria,
    1
  ),
  returnToStageRef: TaskOpaqueRef.optional(),
  maxAttempts: z.number().int().min(1).max(3)
})
const WorkflowDefinitionInputSchema = z.strictObject({
  contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
  kind: z.literal('workflow.definition'),
  scope: WorkflowScopeSchema,
  ...WorkflowReferenceFields,
  stages: boundedTaskCollection(WorkflowStageSchema, WORKFLOW_STAGE_LIMITS.stages, 4),
  maxParallelism: z.number().int().min(1).max(4),
  maxDurationMs: z.number().int().min(1000).max(86_400_000)
})
type Definition = z.infer<typeof WorkflowDefinitionInputSchema>

function graphRefusal(definition: Definition) {
  const stages = new Map(definition.stages.map((stage) => [stage.stageRef, stage]))
  if (stages.size !== definition.stages.length) {
    return 'workflow_duplicate_stage'
  }
  if (new Set(definition.stages.map((stage) => stage.role)).size !== 4) {
    return 'workflow_roles_incomplete'
  }
  for (const stage of definition.stages) {
    if (stage.acceptanceCriteria.some((criterion) => !criterion.trim())) {
      return 'workflow_definition_invalid'
    }
    if (new Set(stage.dependsOn).size !== stage.dependsOn.length) {
      return 'workflow_duplicate_dependency'
    }
    if (stage.dependsOn.some((ref) => !stages.has(ref))) {
      return 'workflow_unknown_dependency'
    }
  }
  const settled = new Set<string>()
  const ancestors = new Map<string, Set<string>>()
  while (settled.size < stages.size) {
    let advanced = false
    for (const stage of stages.values()) {
      if (settled.has(stage.stageRef) || !stage.dependsOn.every((ref) => settled.has(ref))) {
        continue
      }
      const inherited = new Set(stage.dependsOn)
      for (const dependency of stage.dependsOn) {
        for (const ancestor of ancestors.get(dependency) ?? []) {
          inherited.add(ancestor)
        }
      }
      ancestors.set(stage.stageRef, inherited)
      settled.add(stage.stageRef)
      advanced = true
    }
    if (!advanced) {
      return 'workflow_dependency_cycle'
    }
  }
  for (const stage of stages.values()) {
    const expectedOutput = {
      product: 'requirements',
      developer: 'code',
      tester: 'test_report',
      ops: 'release_plan'
    }[stage.role]
    if (stage.outputKind !== expectedOutput) {
      return 'workflow_output_mismatch'
    }
    const requiredRole =
      stage.role === 'developer'
        ? 'product'
        : stage.role === 'tester'
          ? 'developer'
          : stage.role === 'ops'
            ? 'tester'
            : null
    if (
      requiredRole &&
      ![...(ancestors.get(stage.stageRef) ?? [])].some(
        (ref) => stages.get(ref)?.role === requiredRole
      )
    ) {
      return 'workflow_test_dependency_required'
    }
    if (
      (stage.role === 'tester' && !stage.returnToStageRef) ||
      (stage.returnToStageRef &&
        (!ancestors.get(stage.stageRef)?.has(stage.returnToStageRef) ||
          (stage.role === 'tester' && stages.get(stage.returnToStageRef)?.role !== 'developer')))
    ) {
      return 'workflow_return_stage_invalid'
    }
  }
  return null
}

export const WorkflowDefinitionSchema = WorkflowDefinitionInputSchema.superRefine(
  (definition, context) => {
    const reason = graphRefusal(definition)
    if (reason) {
      context.addIssue({ code: 'custom', message: reason })
    }
  }
)

export function workflowDefinitionRefusal(value: unknown) {
  const parsed = WorkflowDefinitionInputSchema.safeParse(value)
  return parsed.success ? graphRefusal(parsed.data) : 'workflow_definition_invalid'
}

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>
