import { z } from 'zod'
import { HiveWorkflowCaseReadQuerySchema } from './hive-workflow-cases'
import { TaskOpaqueRef, boundedTaskCollection } from './task-execution/task-execution-primitives'
import { WorkflowCodeVersionSchema } from './task-workflow/workflow-evidence'
import {
  TaskCodeSnapshotFileSchema,
  TaskCodeSnapshotPathSchema
} from './task-workflow/workflow-code-snapshot-tree'

export const HIVE_WORKFLOW_CODE_INSPECTION_LIMITS = Object.freeze({
  pageFiles: 50,
  pageBytes: 128 * 1024,
  previewBytes: 256 * 1024,
  responseBytes: 2 * 1024 * 1024
})
export const HiveWorkflowCodeVersionSchema = WorkflowCodeVersionSchema.options[1]
  .extend({
    snapshot: WorkflowCodeVersionSchema.options[1].shape.snapshot.extend({
      artifactRevision: z.literal(1)
    })
  })
  .refine((version) => version.snapshot.artifactRef === `artifact:${version.snapshot.digest}`)
const Scope = HiveWorkflowCaseReadQuerySchema.extend({ handoffRef: TaskOpaqueRef })
const Cursor = z.strictObject({
  snapshotRef: TaskOpaqueRef,
  afterPath: TaskCodeSnapshotPathSchema
})
export const HiveWorkflowCaseCodePageQuerySchema = Scope.extend({
  after: Cursor.optional(),
  limit: z.number().int().min(1).max(HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.pageFiles).default(50)
})
export const HiveWorkflowCaseCodeFileQuerySchema = Scope.extend({
  path: TaskCodeSnapshotPathSchema
})
const VersionedScope = Scope.extend({ codeVersion: HiveWorkflowCodeVersionSchema })
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
export const HiveWorkflowCaseCodePageSchema = VersionedScope.extend({
  files: boundedTaskCollection(
    TaskCodeSnapshotFileSchema,
    HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.pageFiles
  ),
  nextCursor: Cursor.nullable()
}).superRefine((page, context) => {
  if (
    page.files.some((file, index) => index > 0 && file.path <= page.files[index - 1].path) ||
    (page.nextCursor &&
      (page.nextCursor.snapshotRef !== page.codeVersion.snapshot.artifactRef ||
        page.nextCursor.afterPath !== page.files.at(-1)?.path)) ||
    byteLength(page) > HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.pageBytes
  ) {
    context.addIssue({ code: 'custom', message: 'workflow_code_page_mismatch' })
  }
})
export const HiveWorkflowCaseCodeFileSchema = VersionedScope.extend({
  file: TaskCodeSnapshotFileSchema,
  preview: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('text'),
      text: z.string().max(HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.previewBytes)
    }),
    z.strictObject({ kind: z.literal('unavailable'), reason: z.enum(['binary', 'too_large']) })
  ])
}).superRefine((value, context) => {
  if (
    (value.preview.kind === 'text' &&
      new TextEncoder().encode(value.preview.text).byteLength !== value.file.size) ||
    (value.preview.kind === 'text' &&
      value.file.size > HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.previewBytes) ||
    (value.preview.kind === 'unavailable' &&
      value.preview.reason === 'too_large' &&
      value.file.size <= HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.previewBytes) ||
    byteLength(value) > HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.responseBytes
  ) {
    context.addIssue({ code: 'custom', message: 'workflow_code_preview_mismatch' })
  }
})
export type HiveWorkflowCaseCodePageQuery = z.input<typeof HiveWorkflowCaseCodePageQuerySchema>
export type HiveWorkflowCaseCodeFileQuery = z.infer<typeof HiveWorkflowCaseCodeFileQuerySchema>
export type HiveWorkflowCaseCodePage = z.infer<typeof HiveWorkflowCaseCodePageSchema>
export type HiveWorkflowCaseCodeFile = z.infer<typeof HiveWorkflowCaseCodeFileSchema>
export type HiveWorkflowCaseCodeApi = {
  getWorkflowCaseCodePage(query: HiveWorkflowCaseCodePageQuery): Promise<HiveWorkflowCaseCodePage>
  getWorkflowCaseCodeFile(query: HiveWorkflowCaseCodeFileQuery): Promise<HiveWorkflowCaseCodeFile>
}
