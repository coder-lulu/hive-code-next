import { z } from 'zod'
import { HiveWorkflowCaseRunReadSchema } from './hive-workflow-case-runs'
import { JournalCursor, SessionId } from './rpc-contract/structured-agent-session-params'
import {
  AgentJournalSubagentEntrySchema,
  isAdmissibleAgentJournalRenderItem,
  isAdmissibleAgentJournalSubmission
} from './agent-session-journal-schemas'
import {
  AGENT_JOURNAL_RESET_REASONS,
  type AgentJournalRenderItem,
  type AgentJournalSubmission
} from './agent-session-journal-types'
import { agentJournalSubmissionKey } from './agent-session-journal-item-key'
import { compareAgentJournalItems } from './agent-session-journal-position'
import { stringifyJsonWithinByteLimit } from './node-bounded-json-stringify'
import type { NativeChatSubagentEntry } from './native-chat-types'

export const HIVE_WORKFLOW_SESSION_RESPONSE_BYTES = 2 * 1024 * 1024
const limit = z.number().int().min(1).max(200).default(40)
const scope = HiveWorkflowCaseRunReadSchema.shape
const publicSubmission = z
  .custom<AgentJournalSubmission>(isAdmissibleAgentJournalSubmission)
  .transform((value) => ({
    clientMessageId: value.clientMessageId,
    fence: value.fence,
    payloadFingerprint: value.payloadFingerprint,
    dispatchState: value.dispatchState,
    providerItemId: value.providerItemId,
    reason: value.reason,
    submittedAt: value.submittedAt,
    resolvedAt: value.resolvedAt,
    ...(value.rejection === undefined ? {} : { rejection: value.rejection }),
    ...(value.recovered === undefined ? {} : { recovered: value.recovered }),
    ...(value.handoverRecorded === undefined ? {} : { handoverRecorded: value.handoverRecorded }),
    ...(value.handedOverAt === undefined ? {} : { handedOverAt: value.handedOverAt })
  }))
export const HiveWorkflowCaseSessionReadSchema = z.discriminatedUnion('direction', [
  z.strictObject({ ...scope, direction: z.literal('tail'), limit }),
  z.strictObject({ ...scope, direction: z.literal('before'), cursor: JournalCursor, limit })
])
const page = z
  .strictObject({
    sessionId: SessionId,
    epoch: z.string().min(1).max(512),
    fence: z.number().int().nonnegative().optional(),
    direction: z.enum(['tail', 'before']),
    items: z
      .array(z.custom<AgentJournalRenderItem>(isAdmissibleAgentJournalRenderItem))
      .max(20_000),
    submissions: z.array(publicSubmission).max(20_000),
    removedItemIds: z.array(z.never()),
    window: z.strictObject({
      oldest: JournalCursor.nullable(),
      newest: JournalCursor.nullable(),
      nextCursor: JournalCursor
    }),
    liveCursor: JournalCursor.optional(),
    hasOlder: z.boolean(),
    hasNewer: z.boolean(),
    hostNow: z.number().finite().optional(),
    subagentRoster: z
      .array(
        z.strictObject({
          itemId: z.string().min(1),
          sequence: z.number().int().nonnegative(),
          sequenceIndex: z.number().int().nonnegative().optional(),
          revision: z.number().int(),
          entry: z.custom<NativeChatSubagentEntry>(
            (value) => AgentJournalSubagentEntrySchema.safeParse(value).success
          )
        })
      )
      .max(20_000)
      .optional()
  })
  .superRefine((value, context) => {
    const positions = [
      value.window.oldest,
      value.window.newest,
      value.window.nextCursor,
      value.liveCursor
    ]
    const ids = new Set(value.items.map((item) => item.itemId))
    const submissions = new Set(value.submissions.map((item) => item.clientMessageId))
    if (
      positions.some((position) => position && position.epoch !== value.epoch) ||
      ids.size !== value.items.length ||
      submissions.size !== value.submissions.length ||
      value.items.some(
        (item, index) =>
          item.sequence < 1 ||
          (index > 0 && compareAgentJournalItems(value.items[index - 1], item) > 0)
      ) ||
      value.submissions.some((item) => !ids.has(agentJournalSubmissionKey(item.clientMessageId))) ||
      value.window.oldest?.sequence !== value.items[0]?.sequence ||
      value.window.newest?.sequence !== value.items.at(-1)?.sequence ||
      (value.items.length > 0 && value.window.nextCursor.sequence !== value.items[0].sequence) ||
      (value.liveCursor && value.items.some((item) => item.sequence > value.liveCursor!.sequence))
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_session_history_mismatch' })
    }
  })
const history = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), page }),
  z.strictObject({
    ok: z.literal(false),
    reset: z.enum(AGENT_JOURNAL_RESET_REASONS),
    page,
    fence: z.number().int().nonnegative().optional()
  })
])
export const HiveWorkflowCaseSessionPageSchema = z
  .strictObject({
    ...scope,
    sessionId: SessionId,
    workspaceId: z.string().min(1).max(512),
    executionHostId: z.literal('local'),
    provider: z.literal('codex'),
    history
  })
  .superRefine((value, context) => {
    if (
      value.history.page.sessionId !== value.sessionId ||
      (!value.history.ok && value.history.page.direction !== 'tail')
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_session_identity_mismatch' })
    }
    try {
      stringifyJsonWithinByteLimit(value, HIVE_WORKFLOW_SESSION_RESPONSE_BYTES)
    } catch {
      context.addIssue({ code: 'custom', message: 'workflow_session_response_too_large' })
    }
  })
export type HiveWorkflowCaseSessionRead = z.input<typeof HiveWorkflowCaseSessionReadSchema>
export type HiveWorkflowCaseSessionPage = z.infer<typeof HiveWorkflowCaseSessionPageSchema>
export type HiveWorkflowCaseSessionApi = {
  getWorkflowCaseSessionPage(
    query: HiveWorkflowCaseSessionRead
  ): Promise<HiveWorkflowCaseSessionPage>
}
