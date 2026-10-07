import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import {
  HiveWorkflowSaveSchema,
  type HiveWorkflowSave,
  type HiveWorkflowSnapshot
} from '../../../../../shared/hive-task-workflows'
import {
  workflowDefinitionRefusal,
  type WorkflowDefinition
} from '../../../../../shared/task-workflow/workflow-definition'
import { createBrowserUuid } from '@/lib/browser-uuid'

export const workflowRoles = ['product', 'developer', 'tester', 'ops'] as const
export type WorkflowStage = WorkflowDefinition['stages'][number]
export type WorkflowRole = WorkflowStage['role']
export type HiveWorkflowDraft = {
  localRef: string
  workflowId?: string
  expectedRevision: number
  name: string
  stages: WorkflowStage[]
  maxParallelism: number
  maxDurationMs: number
}
const outputKinds = {
  product: 'requirements',
  developer: 'code',
  tester: 'test_report',
  ops: 'release_plan'
} as const

export function createWorkflowDraft(copy: (key: string) => string): HiveWorkflowDraft {
  const refs = workflowRoles.map(() => createBrowserUuid())
  return {
    localRef: createBrowserUuid(),
    expectedRevision: 0,
    name: copy('hiveWorkflow.defaultName'),
    maxParallelism: 1,
    maxDurationMs: 3_600_000,
    stages: workflowRoles.map((role, index) => ({
      stageRef: refs[index],
      role,
      outputKind: outputKinds[role],
      dependsOn: index ? [refs[index - 1]] : [],
      acceptanceCriteria: [copy(`hiveWorkflow.defaultCriteria.${role}`)],
      ...(role === 'tester' ? { returnToStageRef: refs[1] } : {}),
      maxAttempts: 2
    }))
  }
}
export function workflowDraftFromSnapshot(snapshot: HiveWorkflowSnapshot): HiveWorkflowDraft {
  return {
    localRef: snapshot.workflowId,
    workflowId: snapshot.workflowId,
    expectedRevision: snapshot.definition.workflowRevision,
    name: snapshot.name,
    stages: structuredClone(snapshot.definition.stages),
    maxParallelism: snapshot.definition.maxParallelism,
    maxDurationMs: snapshot.definition.maxDurationMs
  }
}
export function workflowDraftInput(
  draft: HiveWorkflowDraft,
  team: HiveWorkbenchTeam
): Omit<HiveWorkflowSave, 'requestId'> {
  return {
    projectId: team.project.id,
    ...(draft.workflowId ? { workflowId: draft.workflowId } : {}),
    expectedRevision: draft.expectedRevision,
    expectedProjectRevision: team.project.binding.bindingRevision,
    name: draft.name.trim(),
    stages: draft.stages.map((stage) => ({
      ...stage,
      acceptanceCriteria: stage.acceptanceCriteria
        .map((criterion) => criterion.trim())
        .filter(Boolean)
    })),
    maxParallelism: draft.maxParallelism,
    maxDurationMs: draft.maxDurationMs
  }
}
export function workflowDraftRefusal(
  draft: HiveWorkflowDraft,
  team: HiveWorkbenchTeam
): string | null {
  const input = workflowDraftInput(draft, team)
  if (!HiveWorkflowSaveSchema.safeParse({ ...input, requestId: draft.localRef }).success) {
    return 'workflow_definition_invalid'
  }
  const definition = {
    contractVersion: 1,
    kind: 'workflow.definition',
    scope: team.project.binding.scope,
    workflowRef: draft.localRef,
    workflowRevision: draft.expectedRevision + 1,
    stages: input.stages,
    maxParallelism: input.maxParallelism,
    maxDurationMs: input.maxDurationMs
  }
  const refusal = workflowDefinitionRefusal(definition)
  if (refusal) {
    return refusal
  }
  const snapshot = {
    workflowId: draft.localRef,
    name: input.name,
    definition,
    definitionDigest: '0'.repeat(64),
    projectBindingRevision: team.project.binding.bindingRevision
  }
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
  return bytes(snapshot) > 65_536 || bytes({ ...input, requestId: draft.localRef }) > 65_536
    ? 'workflow_definition_too_large'
    : null
}
export function workflowStageAncestors(stages: WorkflowStage[], stageRef: string): Set<string> {
  const byRef = new Map(stages.map((stage) => [stage.stageRef, stage]))
  const pending = [...(byRef.get(stageRef)?.dependsOn ?? [])]
  const ancestors = new Set<string>()
  while (pending.length) {
    const next = pending.pop()
    if (!next || next === stageRef || ancestors.has(next)) {
      continue
    }
    ancestors.add(next)
    pending.push(...(byRef.get(next)?.dependsOn ?? []))
  }
  return ancestors
}
export function appendWorkflowStage(
  draft: HiveWorkflowDraft,
  role: WorkflowRole,
  criterion: string
): HiveWorkflowDraft {
  if (draft.stages.length >= 32) {
    return draft
  }
  const previousRole = { product: null, developer: 'product', tester: 'developer', ops: 'tester' }[
    role
  ]
  const dependency = draft.stages.findLast((stage) => stage.role === previousRole)
  const stage: WorkflowStage = {
    stageRef: createBrowserUuid(),
    role,
    outputKind: outputKinds[role],
    dependsOn: dependency ? [dependency.stageRef] : [],
    acceptanceCriteria: [criterion],
    maxAttempts: 2,
    ...(role === 'tester' && dependency ? { returnToStageRef: dependency.stageRef } : {})
  }
  return { ...draft, stages: [...draft.stages, stage] }
}
export function removeWorkflowStage(draft: HiveWorkflowDraft, stageRef: string): HiveWorkflowDraft {
  const removed = draft.stages.find((stage) => stage.stageRef === stageRef)
  if (
    !removed ||
    draft.stages.length <= 4 ||
    draft.stages.filter((stage) => stage.role === removed.role).length <= 1
  ) {
    return draft
  }
  return {
    ...draft,
    stages: draft.stages
      .filter((stage) => stage.stageRef !== stageRef)
      .map((stage) => {
        const { returnToStageRef, ...rest } = stage
        return {
          ...rest,
          dependsOn: stage.dependsOn.filter((dependency) => dependency !== stageRef),
          ...(returnToStageRef && returnToStageRef !== stageRef ? { returnToStageRef } : {})
        }
      })
  }
}
