import { z } from 'zod'
import { HiveWorkbenchObjectIdInputSchema } from './hive-team-workbench'
import { structuredAgentSessionDigest } from './structured-agent-session-mutation'
import {
  boundedTaskCollection,
  TaskCounter,
  TaskDigest,
  TaskEpoch
} from './task-execution/task-execution-primitives'
import {
  WORKFLOW_STAGE_LIMITS,
  WorkflowDefinitionSchema,
  WorkflowStageSchema
} from './task-workflow/workflow-definition'

const ObjectId = z.string().uuid()
const Name = z.string().trim().min(1).max(160)
const MAX_PAGE_ITEMS = 50
// Schema delimiters: stage 17, definition/snapshot 34, page 6, plus bounded array separators.
export const HIVE_WORKFLOW_PAGE_STRUCTURAL_TOKENS =
  MAX_PAGE_ITEMS *
    (WORKFLOW_STAGE_LIMITS.stages *
      (WORKFLOW_STAGE_LIMITS.dependencies + WORKFLOW_STAGE_LIMITS.acceptanceCriteria + 17) +
      WORKFLOW_STAGE_LIMITS.stages +
      34) +
  MAX_PAGE_ITEMS +
  6

export const HiveWorkflowListQuerySchema = z.strictObject({
  projectId: HiveWorkbenchObjectIdInputSchema,
  after: HiveWorkbenchObjectIdInputSchema.optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_ITEMS).default(25)
})
export const HiveWorkflowReadQuerySchema = z.strictObject({
  projectId: HiveWorkbenchObjectIdInputSchema,
  workflowId: HiveWorkbenchObjectIdInputSchema,
  revision: TaskEpoch.optional()
})
export const HiveWorkflowSaveSchema = z
  .strictObject({
    requestId: HiveWorkbenchObjectIdInputSchema,
    projectId: HiveWorkbenchObjectIdInputSchema,
    workflowId: HiveWorkbenchObjectIdInputSchema.optional(),
    expectedRevision: TaskCounter,
    expectedProjectRevision: TaskEpoch,
    name: Name,
    stages: boundedTaskCollection(WorkflowStageSchema, WORKFLOW_STAGE_LIMITS.stages, 4),
    maxParallelism: z.number().int().min(1).max(4),
    maxDurationMs: z.number().int().min(1000).max(86_400_000)
  })
  .superRefine((input, context) => {
    if (input.workflowId ? input.expectedRevision < 1 : input.expectedRevision !== 0) {
      context.addIssue({ code: 'custom', message: 'workflow_revision_invalid' })
    }
  })
export const HiveWorkflowSnapshotSchema = z
  .strictObject({
    workflowId: ObjectId,
    name: Name,
    definition: WorkflowDefinitionSchema,
    definitionDigest: TaskDigest,
    projectBindingRevision: TaskEpoch
  })
  .superRefine((snapshot, context) => {
    if (
      snapshot.workflowId !== snapshot.definition.workflowRef ||
      !ObjectId.safeParse(snapshot.definition.scope.companyRef).success ||
      !ObjectId.safeParse(snapshot.definition.scope.projectRef).success
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_scope_mismatch' })
    }
    if (
      snapshot.definitionDigest !==
      structuredAgentSessionDigest({ name: snapshot.name, definition: snapshot.definition })
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_definition_digest_mismatch' })
    }
  })
export const HiveWorkflowPageSchema = z.strictObject({
  items: boundedTaskCollection(HiveWorkflowSnapshotSchema, MAX_PAGE_ITEMS),
  nextCursor: ObjectId.nullable()
})

export type HiveWorkflowListQuery = z.input<typeof HiveWorkflowListQuerySchema>
export type HiveWorkflowReadQuery = z.infer<typeof HiveWorkflowReadQuerySchema>
export type HiveWorkflowSave = z.infer<typeof HiveWorkflowSaveSchema>
export type HiveWorkflowSnapshot = z.infer<typeof HiveWorkflowSnapshotSchema>
export type HiveWorkflowPage = z.infer<typeof HiveWorkflowPageSchema>
export type HiveTaskWorkflowsApi = {
  listWorkflows(query: HiveWorkflowListQuery): Promise<HiveWorkflowPage>
  getWorkflow(query: HiveWorkflowReadQuery): Promise<HiveWorkflowSnapshot>
  saveWorkflow(input: HiveWorkflowSave): Promise<HiveWorkflowSnapshot>
}
