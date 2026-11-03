import { CLIENT_PROVENANCE_SNAPSHOT_MAX } from '../automation-workspace-provenance'
import { z } from 'zod'
import { normalizeExecutionHostId } from '../execution-host'
import { isTuiAgent } from '../tui-agent-config'
import type { TuiAgent } from '../tui-agent'
import {
  OptionalBoolean,
  OptionalFiniteNumber,
  OptionalPlainString,
  OptionalString,
  TriStateLinkedIssue
} from './rpc-param-primitives'
import { RUNTIME_NAVIGATION_TARGETS } from '../runtime-navigation'
import { WorkspaceLinkedItemSchema } from '../workspace-linked-item-schema'
import { WorkspaceAttachmentsSchema } from '../workspace-attachment-schema'
import { DiffCommentSchema, MobileDiffReviewSchema } from '../diff-comment-schema'
import { TaskSourceContextSchema } from '../task-source-context-schema'
import { isWorkspaceLinkedItemSourceContextMatch } from '../workspace-linked-item-source-context'

export const OptionalExecutionHostId = z
  .string()
  .transform((value, ctx) => {
    const hostId = normalizeExecutionHostId(value)
    if (!hostId) {
      ctx.addIssue({ code: 'custom', message: 'Invalid host id' })
      return z.NEVER
    }
    return hostId
  })
  .optional()

export const OptionalTuiAgent = z
  .unknown()
  .superRefine((value, ctx) => {
    if (value !== undefined && !isTuiAgent(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Unknown TUI agent' })
    }
  })
  .transform((value): TuiAgent | undefined => (isTuiAgent(value) ? value : undefined))
  .optional()

/** Descriptive remote-owner labels; automation authority still requires the host's dispatch token. */
export const ClientAutomationWorkspaceProvenance = z.object({
  automationId: z.string().min(1).max(256),
  automationNameSnapshot: z.string().max(CLIENT_PROVENANCE_SNAPSHOT_MAX),
  automationRunId: z.string().min(1).max(256),
  automationRunTitleSnapshot: z.string().max(CLIENT_PROVENANCE_SNAPSHOT_MAX),
  executionTargetType: z.enum(['local', 'ssh']),
  executionTargetId: z.string().max(256),
  projectId: z.string().max(256),
  repoId: z.string().max(256).optional(),
  hostId: OptionalExecutionHostId
})

export const AutomationWorkspaceProvenanceRequest = z.object({
  automationId: z.string(),
  automationRunId: z.string(),
  dispatchToken: z.string(),
  createRequestId: z.string()
})

// Why no dispatch token (unlike automation provenance): this is a descriptive
// origin marker for sidebar filtering, not an authority grant. The host stamps
// createdAt itself so a client clock can't skew sort order.
export const CliWorkspaceProvenanceRequest = z.object({
  callerTerminalHandle: OptionalString
})

export const WorktreeListParams = z.object({
  repo: OptionalString,
  limit: OptionalFiniteNumber
})

export const WorktreeDetectedListParams = z.object({
  repo: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing repo selector'))
})

export const WorktreeTeardownMissingTerminalsParams = WorktreeDetectedListParams.extend({
  worktreeIds: z.array(z.string().min(1)).max(10_000),
  connectionId: z.string().nullable().optional()
})

export const WorktreePsParams = z.object({
  limit: OptionalFiniteNumber,
  includeAgentWait: OptionalBoolean,
  afterSnapshotId: z.string().min(1).max(128).nullable().optional(),
  supportsWorktreeVisibilitySourceDefaults: z.literal(true).optional()
})

export const WorktreeSortOrder = z.object({
  orderedIds: z.array(z.string())
})

export const WorktreeSelector = z.object({
  worktree: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing worktree selector'))
})

export const WorktreeSleepParams = WorktreeSelector.extend({
  markChatsAsleep: z.boolean().optional()
})

export const WorktreeActivate = WorktreeSelector.extend({
  notifyClients: OptionalBoolean,
  navigation: z.enum(RUNTIME_NAVIGATION_TARGETS).optional()
})

/** Shared by WorktreeCreate and WorktreeSet so the two error messages cannot drift. */
export function assertLinkedWorkItemSourceContextMatch(
  params: {
    linkedWorkItem?: z.infer<typeof WorkspaceLinkedItemSchema> | null
    linkedTaskSourceContext?: z.infer<typeof TaskSourceContextSchema> | null
  },
  ctx: z.RefinementCtx
): void {
  if (
    params.linkedWorkItem &&
    params.linkedTaskSourceContext &&
    !isWorkspaceLinkedItemSourceContextMatch(params.linkedWorkItem, params.linkedTaskSourceContext)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Linked work item and source context identities must match'
    })
  }
}

export const WorktreeGitHubLinkBase = z
  .object({
    hostId: OptionalExecutionHostId.unwrap(),
    instanceId: z.string().min(1).nullable(),
    linkedPR: z.number().int().positive().nullable(),
    suppressedGitHubPR: z.number().int().positive().nullable()
  })
  .strict()

export const WorktreeSet = WorktreeSelector.extend({
  // Why: '' is the blanking contract — "fall back to the branch/folder name".
  // OptionalString coerced it to undefined, so on remote/SSH hosts clearing the
  // name was dropped here and the old name came back on the next refresh.
  displayName: OptionalPlainString,
  // Why: empty comments are meaningful metadata updates, so use the plain
  // string parser instead of OptionalString's empty-as-undefined behavior.
  comment: OptionalPlainString,
  linkedIssue: TriStateLinkedIssue,
  linkedPR: TriStateLinkedIssue,
  suppressedGitHubPR: z.number().int().positive().nullable().optional(),
  githubLinkBase: WorktreeGitHubLinkBase.optional(),
  linkedLinearIssue: z.union([z.string(), z.null()]).optional(),
  linkedLinearIssueWorkspaceId: z.union([z.string(), z.null()]).optional(),
  linkedLinearIssueOrganizationUrlKey: z.union([z.string(), z.null()]).optional(),
  linkedGitLabMR: TriStateLinkedIssue,
  linkedGitLabIssue: TriStateLinkedIssue,
  linkedBitbucketPR: TriStateLinkedIssue,
  linkedAzureDevOpsPR: TriStateLinkedIssue,
  linkedGiteaPR: TriStateLinkedIssue,
  linkedWorkItem: WorkspaceLinkedItemSchema.nullable().optional(),
  linkedItems: WorkspaceAttachmentsSchema.optional(),
  linkedItemsBase: WorkspaceAttachmentsSchema.optional(),
  linkedItemsSelectionChanged: z.boolean().optional(),
  linkedTaskSourceContext: TaskSourceContextSchema.nullable().optional(),
  isArchived: OptionalBoolean,
  isUnread: OptionalBoolean,
  isPinned: OptionalBoolean,
  sortOrder: OptionalFiniteNumber,
  manualOrder: OptionalFiniteNumber,
  lastActivityAt: OptionalFiniteNumber,
  createdAt: OptionalFiniteNumber,
  sparseDirectories: z.array(z.string()).optional(),
  sparseBaseRef: OptionalString,
  sparsePresetId: OptionalString,
  baseRef: OptionalString,
  workspaceStatus: OptionalString,
  pushTarget: z
    .object({
      remoteName: z.string(),
      branchName: z.string(),
      remoteUrl: OptionalString
    })
    .nullable()
    .optional(),
  // Older clients may send unsupported review shapes alongside unrelated metadata edits.
  diffComments: z.array(DiffCommentSchema).optional().catch(undefined),
  diffCommentsBase: z.array(DiffCommentSchema).optional(),
  firstAgentMessageRenameError: z.null().optional(),
  mobileDiffReview: MobileDiffReviewSchema.optional().catch(undefined),
  parentWorktree: OptionalString,
  noParent: OptionalBoolean
}).superRefine((params, ctx) => {
  assertLinkedWorkItemSourceContextMatch(params, ctx)
  if (
    (params.linkedPR === null || params.suppressedGitHubPR !== undefined) &&
    params.githubLinkBase === undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['githubLinkBase'],
      message: 'A captured GitHub link snapshot is required to clear or suppress a PR.'
    })
  }
  if (params.parentWorktree && params.noParent === true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choose either --parent-worktree or --no-parent, not both.'
    })
  }
})

export const WorktreeRemove = WorktreeSelector.extend({
  hostId: OptionalExecutionHostId,
  force: OptionalBoolean,
  // Why (#11960): the CLI's --force is an unambiguous force affordance, but the
  // desktop sets `force` for an ordinary confirmed delete too, so the PTY-stop
  // waiver travels on its own field.
  allowUnverifiedPtyStop: OptionalBoolean,
  runHooks: OptionalBoolean,
  // Why (#19334): a failed archive hook blocks removal. This waives that refusal and is recorded
  // in the result; it is NOT `force`, and it does not decide whether the hook runs.
  allowFailedArchiveHook: OptionalBoolean
})

export const WorktreeForceDeleteBranch = WorktreeSelector.extend({
  hostId: OptionalExecutionHostId,
  branchName: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing branch name')),
  expectedHead: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing expected branch head'))
})

export const WorktreeResolvePrBase = z.object({
  repo: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing repo selector')),
  prNumber: z
    .unknown()
    .transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))
    .pipe(z.number().int().positive('Missing PR number')),
  headRefName: OptionalString,
  baseRefName: OptionalString,
  isCrossRepository: OptionalBoolean
})

export const WorktreeResolveMrBase = z.object({
  repo: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing repo selector')),
  mrIid: z
    .unknown()
    .transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))
    .pipe(z.number().int().positive('Missing MR number')),
  sourceBranch: OptionalString,
  targetBranch: OptionalString,
  isCrossRepository: OptionalBoolean
})
