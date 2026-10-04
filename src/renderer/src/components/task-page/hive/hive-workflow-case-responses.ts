import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import {
  HiveWorkflowCasePageSchema,
  HiveWorkflowCaseSummarySchema,
  HiveWorkflowCaseViewSchema,
  type HiveWorkflowCaseCreate,
  type HiveWorkflowCaseSummary,
  type HiveWorkflowCaseView
} from '../../../../../shared/hive-workflow-cases'
import { structuredAgentSessionDigest } from '../../../../../shared/structured-agent-session-mutation'

function assertCaseScope(
  summary: HiveWorkflowCaseSummary,
  team: HiveWorkbenchTeam,
  workflowId: string
) {
  if (
    summary.binding.scope.companyRef !== team.company.id ||
    summary.binding.scope.projectRef !== team.project.id ||
    summary.binding.workflowRef !== workflowId
  ) {
    throw new Error('FORBIDDEN')
  }
}
export function readWorkflowCase(
  value: unknown,
  team: HiveWorkbenchTeam,
  workflowId: string
): HiveWorkflowCaseView {
  const parsed = HiveWorkflowCaseViewSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('INVALID_RESPONSE')
  }
  const view = parsed.data
  assertCaseScope(view, team, workflowId)
  const owner = (binding: typeof team.company.binding) => ({
    ownerScope: binding.ownerScope,
    ownerAccountRef: binding.ownerAccountRef,
    ownerActorRef: binding.ownerActorRef
  })
  if (
    structuredAgentSessionDigest(owner(view.team.company)) !==
    structuredAgentSessionDigest(owner(team.company.binding))
  ) {
    throw new Error('FORBIDDEN')
  }
  return view
}
export function readWorkflowCasePage(
  value: unknown,
  team: HiveWorkbenchTeam,
  workflowId: string,
  after?: string
) {
  const parsed = HiveWorkflowCasePageSchema.safeParse(value)
  if (!parsed.success || parsed.data.items.length > 25) {
    throw new Error('INVALID_RESPONSE')
  }
  const page = parsed.data
  if (
    new Set(page.items.map((item) => item.id)).size !== page.items.length ||
    (page.nextCursor && (page.nextCursor === after || page.items.at(-1)?.id !== page.nextCursor))
  ) {
    throw new Error('INVALID_RESPONSE')
  }
  page.items.forEach((item) => assertCaseScope(item, team, workflowId))
  return page
}
export function assertCreatedWorkflowCase(
  view: HiveWorkflowCaseView,
  input: HiveWorkflowCaseCreate
) {
  // Main verifies the admission receipt; a replay returns the case's current content.
  if (
    view.binding.workflowRevision !== input.workflowRevision ||
    view.definitionDigest !== input.definitionDigest ||
    view.projectBindingRevision !== input.expectedProjectRevision
  ) {
    throw new Error('INVALID_RESPONSE')
  }
}
export function summarizeWorkflowCase(view: HiveWorkflowCaseView): HiveWorkflowCaseSummary {
  return HiveWorkflowCaseSummarySchema.parse({
    id: view.id,
    title: view.title,
    binding: view.binding,
    definitionDigest: view.definitionDigest,
    projectBindingRevision: view.projectBindingRevision,
    revision: view.revision,
    currentStageRef: view.currentStageRef,
    terminalKind: view.terminalKind,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt
  })
}
export function mergeWorkflowCaseSummaries(
  previous: HiveWorkflowCaseSummary[],
  received: HiveWorkflowCaseSummary[]
) {
  const items = new Map(previous.map((item) => [item.id, item]))
  for (const item of received) {
    const existing = items.get(item.id)
    if (!existing || existing.revision <= item.revision) {
      items.set(item.id, item)
    }
  }
  return [...items.values()]
}
