import { z } from 'zod'
import {
  isAdmissibleAgentJournalRenderItem,
  isAdmissibleAgentJournalSubmission
} from '../../../shared/agent-session-journal-schemas'
import {
  AGENT_JOURNAL_RESET_REASONS,
  type AgentJournalRenderItem,
  type AgentJournalSubmission
} from '../../../shared/agent-session-journal-types'
import { hiveAgentSessionIdSchema } from '../../../shared/hive-agent-session-schema'

const cursor = z.object({ epoch: z.string().min(1), sequence: z.number().int().nonnegative() })
const content = {
  items: z.array(z.custom<AgentJournalRenderItem>(isAdmissibleAgentJournalRenderItem)),
  submissions: z.array(z.custom<AgentJournalSubmission>(isAdmissibleAgentJournalSubmission)),
  removedItemIds: z.array(z.string().min(1))
}
const page = z
  .object({
    sessionId: hiveAgentSessionIdSchema,
    epoch: z.string().min(1),
    fence: z.number().int().nonnegative().optional(),
    direction: z.enum(['tail', 'before', 'after']),
    ...content,
    window: z.object({ oldest: cursor.nullable(), newest: cursor.nullable(), nextCursor: cursor }),
    liveCursor: cursor.optional(),
    hasOlder: z.boolean(),
    hasNewer: z.boolean(),
    hostNow: z.number().finite().optional()
  })
  .refine((value) =>
    [value.window.oldest, value.window.newest, value.window.nextCursor, value.liveCursor].every(
      (position) => !position || position.epoch === value.epoch
    )
  )
const reset = z.enum(AGENT_JOURNAL_RESET_REASONS)

/** Reuse journal validation; Hive consumes only the existing timeline wire fields. */
export function hiveAgentHistoryResultSchema(sessionId: string) {
  const pinned = page.refine((value) => value.sessionId === sessionId)
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), page: pinned }),
    z.object({ ok: z.literal(false), reset, page: pinned, fence: z.number().int().optional() })
  ])
}

export function hiveAgentHistoryEventSchema(sessionId: string) {
  const identity = { sessionId: z.literal(sessionId), hostNow: z.number().finite().optional() }
  const snapshot = {
    ...identity,
    page: page.refine((value) => value.sessionId === sessionId),
    fence: z.number().int().nonnegative()
  }
  return z.discriminatedUnion('type', [
    z.object({ type: z.literal('snapshot'), ...snapshot }),
    z.object({ type: z.literal('reset'), ...snapshot, reset }),
    z.object({
      type: z.literal('batch'),
      ...identity,
      batch: z.object({ cursor, ...content }),
      fence: z.number().int().nonnegative().optional()
    }),
    z.object({ type: z.literal('end') })
  ])
}
export type HiveAgentHistoryEvent = z.output<ReturnType<typeof hiveAgentHistoryEventSchema>>
