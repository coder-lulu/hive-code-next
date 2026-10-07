import {
  HiveWorkflowCaseCodePageSchema,
  HiveWorkflowCaseCodeFileSchema,
  HiveWorkflowCodeVersionSchema,
  type HiveWorkflowCaseCodePageQuery,
  type HiveWorkflowCaseCodeFileQuery,
  type HiveWorkflowCaseCodePage
} from '../../../../../shared/hive-workflow-case-code'
import { sha256 } from '../../../../../shared/sha256'
import type { WorkflowHandoff } from '../../../../../shared/task-workflow/workflow-evidence'

export function workflowCodeSelectionKey(handoff: WorkflowHandoff) {
  return JSON.stringify([
    handoff.binding,
    handoff.handoffRef,
    handoff.producer,
    handoff.codeVersion
  ])
}
function sameScope(
  value: { projectId: string; caseId: string; handoffRef: string; codeVersion: unknown },
  query: { projectId: string; caseId: string; handoffRef: string },
  handoff: WorkflowHandoff
) {
  const expected = HiveWorkflowCodeVersionSchema.safeParse(handoff.codeVersion)
  return (
    expected.success &&
    value.projectId === query.projectId &&
    value.caseId === query.caseId &&
    value.handoffRef === query.handoffRef &&
    JSON.stringify(value.codeVersion) === JSON.stringify(expected.data)
  )
}
export function readWorkflowCodePage(
  value: unknown,
  query: HiveWorkflowCaseCodePageQuery,
  handoff: WorkflowHandoff
) {
  const parsed = HiveWorkflowCaseCodePageSchema.safeParse(value)
  const after = query.after
  if (
    !parsed.success ||
    !sameScope(parsed.data, query, handoff) ||
    parsed.data.files.length > (query.limit ?? 50) ||
    (after &&
      (after.snapshotRef !== parsed.data.codeVersion.snapshot.artifactRef ||
        parsed.data.files.some((file) => file.path <= after.afterPath)))
  ) {
    throw new Error('INVALID_RESPONSE')
  }
  return parsed.data
}
export function readWorkflowCodeFile(
  value: unknown,
  query: HiveWorkflowCaseCodeFileQuery,
  page: HiveWorkflowCaseCodePage,
  handoff: WorkflowHandoff
) {
  const parsed = HiveWorkflowCaseCodeFileSchema.safeParse(value)
  const member = page.files.find((file) => file.path === query.path)
  if (
    !parsed.success ||
    !member ||
    !sameScope(parsed.data, query, handoff) ||
    JSON.stringify(parsed.data.file) !== JSON.stringify(member)
  ) {
    throw new Error('INVALID_RESPONSE')
  }
  if (parsed.data.preview.kind === 'text') {
    const bytes = sha256(new TextEncoder().encode(parsed.data.preview.text))
    const digest = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    if (digest !== member.digest) {
      throw new Error('INVALID_RESPONSE')
    }
  }
  return parsed.data
}
