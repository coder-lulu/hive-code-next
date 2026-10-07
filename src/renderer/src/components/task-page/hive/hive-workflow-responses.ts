import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import {
  HiveWorkflowPageSchema,
  HiveWorkflowSnapshotSchema,
  type HiveWorkflowSave,
  type HiveWorkflowSnapshot
} from '../../../../../shared/hive-task-workflows'
import { structuredAgentSessionDigest } from '../../../../../shared/structured-agent-session-mutation'

export function readWorkflowSnapshot(
  value: unknown,
  team: HiveWorkbenchTeam
): HiveWorkflowSnapshot {
  const parsed = HiveWorkflowSnapshotSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('INVALID_RESPONSE')
  }
  const snapshot = parsed.data
  if (
    snapshot.definition.scope.companyRef !== team.company.id ||
    snapshot.definition.scope.projectRef !== team.project.id
  ) {
    throw new Error('FORBIDDEN')
  }
  if (snapshot.projectBindingRevision !== team.project.binding.bindingRevision) {
    throw new Error('REVISION_CONFLICT')
  }
  return snapshot
}
export function readWorkflowPage(value: unknown, team: HiveWorkbenchTeam, after?: string) {
  const parsed = HiveWorkflowPageSchema.safeParse(value)
  if (!parsed.success || parsed.data.items.length > 25) {
    throw new Error('INVALID_RESPONSE')
  }
  const page = parsed.data
  if (
    new Set(page.items.map((item) => item.workflowId)).size !== page.items.length ||
    (page.nextCursor &&
      (page.nextCursor === after || page.items.at(-1)?.workflowId !== page.nextCursor))
  ) {
    throw new Error('INVALID_RESPONSE')
  }
  return { ...page, items: page.items.map((item) => readWorkflowSnapshot(item, team)) }
}
export function assertSavedWorkflow(snapshot: HiveWorkflowSnapshot, input: HiveWorkflowSave) {
  const savedInput = {
    name: snapshot.name,
    stages: snapshot.definition.stages,
    maxParallelism: snapshot.definition.maxParallelism,
    maxDurationMs: snapshot.definition.maxDurationMs
  }
  const requestedInput = {
    name: input.name,
    stages: input.stages,
    maxParallelism: input.maxParallelism,
    maxDurationMs: input.maxDurationMs
  }
  if (
    (input.workflowId && snapshot.workflowId !== input.workflowId) ||
    snapshot.definition.workflowRevision !== input.expectedRevision + 1 ||
    structuredAgentSessionDigest(savedInput) !== structuredAgentSessionDigest(requestedInput)
  ) {
    throw new Error('INVALID_RESPONSE')
  }
}
export function mergeWorkflowSnapshots(
  previous: HiveWorkflowSnapshot[],
  received: HiveWorkflowSnapshot[]
): HiveWorkflowSnapshot[] {
  const entries = new Map(previous.map((item) => [item.workflowId, item]))
  for (const item of received) {
    const existing = entries.get(item.workflowId)
    if (!existing || existing.definition.workflowRevision <= item.definition.workflowRevision) {
      entries.set(item.workflowId, item)
    }
  }
  return [...entries.values()]
}
