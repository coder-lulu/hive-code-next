import {
  HiveWorkflowCaseCodePageSchema,
  HiveWorkflowCaseCodeFileSchema,
  type HiveWorkflowCaseCodePage,
  type HiveWorkflowCaseCodeFile
} from '../../../../../shared/hive-workflow-case-code'
import { HiveWorkflowCaseViewSchema } from '../../../../../shared/hive-workflow-cases'
import { sha256 } from '../../../../../shared/sha256'
import { workflowCaseEvidenceFixture } from './hive-workflow-case-evidence.test-fixtures'

export function workflowCodeTextDigest(text: string) {
  return Array.from(sha256(new TextEncoder().encode(text)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}
// Presentation-only data: no native artifact, original record or Provider qualification.
export function workflowCaseCodeFixture() {
  const f = workflowCaseEvidenceFixture()
  const codeVersion = {
    kind: 'snapshot' as const,
    snapshot: {
      artifactRef: `artifact:${'c'.repeat(64)}`,
      artifactRevision: 1 as const,
      digest: 'c'.repeat(64)
    },
    treeDigest: 'd'.repeat(64)
  }
  const view = HiveWorkflowCaseViewSchema.parse({
    ...f.view,
    executionAvailability: { available: false, reason: 'EXECUTION_ISOLATION_UNAVAILABLE' },
    handoffs: f.view.handoffs.map((handoff) => ({ ...handoff, codeVersion })),
    reviews: f.view.reviews.map((review) => ({ ...review, codeVersion }))
  })
  const handoff = view.handoffs.find((item) => item.producer.role === 'developer')!
  const scope = {
    projectId: view.binding.scope.projectRef,
    caseId: view.id,
    handoffRef: handoff.handoffRef,
    codeVersion
  }
  const text = '\ufeff<script>window.secret = true</script>\nexport const value = 1\n'
  const file = {
    path: 'src/main.ts',
    size: new TextEncoder().encode(text).byteLength,
    digest: workflowCodeTextDigest(text),
    executableBits: 0
  }
  const page: HiveWorkflowCaseCodePage = HiveWorkflowCaseCodePageSchema.parse({
    ...scope,
    files: [file],
    nextCursor: null
  })
  const preview: HiveWorkflowCaseCodeFile = HiveWorkflowCaseCodeFileSchema.parse({
    ...scope,
    file,
    preview: { kind: 'text', text }
  })
  return { view, handoff, scope, codeVersion, text, file, page, preview }
}
