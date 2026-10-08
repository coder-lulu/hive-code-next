import { describe, expect, it } from 'vitest'
import {
  HiveWorkflowCaseSessionReadSchema,
  HiveWorkflowCaseSessionPageSchema
} from './hive-workflow-case-session'
import { agentJournalSubmissionKey } from './agent-session-journal-item-key'

const scope = {
  projectId: '11111111-1111-4111-8111-111111111111',
  caseId: '22222222-2222-4222-8222-222222222222',
  taskId: '33333333-3333-4333-8333-333333333333',
  runId: '44444444-4444-4444-8444-444444444444'
}
const position = (sequence: number) => ({ epoch: 'original-epoch', sequence })
function response() {
  return {
    ...scope,
    sessionId: 'original-session',
    workspaceId: 'folder:original-execution',
    executionHostId: 'local',
    provider: 'codex',
    history: {
      ok: true,
      page: {
        sessionId: 'original-session',
        epoch: 'original-epoch',
        direction: 'tail',
        items: [
          {
            itemId: 'original-row',
            sequence: 3,
            revision: 1,
            observedAt: 1,
            body: {
              kind: 'message',
              role: 'assistant',
              blocks: [{ type: 'text', text: 'original answer' }]
            }
          }
        ],
        submissions: [],
        removedItemIds: [],
        hasOlder: false,
        hasNewer: false,
        window: { oldest: position(3), newest: position(3), nextCursor: position(3) },
        liveCursor: position(4)
      }
    }
  }
}
describe('original workflow session read contract', () => {
  it('keeps actual pending handover facts while dropping host-only and queue control metadata', () => {
    const value = response()
    const row = {
      ...value.history.page.items[0],
      itemId: agentJournalSubmissionKey('original-client-message')
    }
    const submission = {
      clientMessageId: 'original-client-message',
      fence: 1,
      payloadFingerprint: 'original-digest',
      dispatchState: 'pending',
      providerItemId: null,
      reason: null,
      submittedAt: 1,
      resolvedAt: null,
      handoverRecorded: true,
      acceptedSequence: 3,
      origin: 'host',
      queuedMessageId: 'private-queue'
    }
    const original = {
      ...value,
      history: {
        ok: true,
        page: { ...value.history.page, items: [row], submissions: [submission] }
      }
    }
    const parsed = HiveWorkflowCaseSessionPageSchema.parse(original)
    expect(parsed.history.page.submissions[0]).toEqual({
      clientMessageId: submission.clientMessageId,
      fence: 1,
      payloadFingerprint: 'original-digest',
      dispatchState: 'pending',
      providerItemId: null,
      reason: null,
      submittedAt: 1,
      resolvedAt: null,
      handoverRecorded: true
    })
    expect(original.history.page.submissions[0]).toEqual(submission)
  })
  it('accepts only original business scope and bounded tail/backward controls', () => {
    expect(HiveWorkflowCaseSessionReadSchema.parse({ ...scope, direction: 'tail' })).toEqual({
      ...scope,
      direction: 'tail',
      limit: 40
    })
    expect(
      HiveWorkflowCaseSessionReadSchema.safeParse({
        ...scope,
        direction: 'before',
        cursor: position(3),
        limit: 200
      }).success
    ).toBe(true)
    for (const override of [
      { sessionId: 'foreign-session' },
      { workspaceId: 'folder:foreign' },
      { authorized: true },
      { direction: 'after' },
      { cursor: position(3) },
      { limit: 0 },
      { limit: 201 }
    ]) {
      expect(
        HiveWorkflowCaseSessionReadSchema.safeParse({ ...scope, direction: 'tail', ...override })
          .success
      ).toBe(false)
    }
    expect(
      HiveWorkflowCaseSessionReadSchema.safeParse({ ...scope, direction: 'before' }).success
    ).toBe(false)
  })
  it('retains original admitted row content and honest reset/empty history', () => {
    const value = response()
    expect(HiveWorkflowCaseSessionPageSchema.parse(value)).toEqual(value)
    expect(
      HiveWorkflowCaseSessionPageSchema.safeParse({
        ...value,
        history: { ...value.history, ok: false, reset: 'epoch_changed' }
      }).success
    ).toBe(true)
    expect(
      HiveWorkflowCaseSessionPageSchema.safeParse({
        ...value,
        history: {
          ok: true,
          page: {
            ...value.history.page,
            items: [],
            window: { oldest: null, newest: null, nextCursor: position(0) }
          }
        }
      }).success
    ).toBe(true)
  })
  it('rejects substituted identity, epochs, cursors, duplicate and malformed original rows', () => {
    const value = response(),
      page = value.history.page
    for (const override of [
      { sessionId: 'foreign-session' },
      { epoch: 'foreign-epoch' },
      { window: { ...page.window, nextCursor: position(4) } },
      { liveCursor: position(2) },
      { items: [page.items[0], page.items[0]] },
      { items: [{ ...page.items[0], body: { kind: 'question', options: null } }] },
      { direction: 'after' },
      { removedItemIds: ['foreign-item'] }
    ]) {
      expect(
        HiveWorkflowCaseSessionPageSchema.safeParse({
          ...value,
          history: { ok: true, page: { ...page, ...override } }
        }).success
      ).toBe(false)
    }
  })
  it('rejects private acquisition and queue controls instead of transporting them', () => {
    const value = response()
    for (const override of [
      { authorizationRef: 'private' },
      { accountHome: { path: 'private' } },
      { spawnToken: 'private' },
      { executionHostId: 'remote' },
      { provider: 'claude' }
    ]) {
      expect(HiveWorkflowCaseSessionPageSchema.safeParse({ ...value, ...override }).success).toBe(
        false
      )
    }
    expect(
      HiveWorkflowCaseSessionPageSchema.safeParse({
        ...value,
        history: { ...value.history, providerSession: { id: 'private' } }
      }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseSessionPageSchema.safeParse({
        ...value,
        history: { ok: true, page: { ...value.history.page, queuedMessages: [] } }
      }).success
    ).toBe(false)
  })
  it('bounds the serialized whole response in UTF-8 and keeps grouped rows above the requested limit valid', () => {
    const value = response()
    value.history.page.items[0].body.blocks[0].text = '验'.repeat(750_000)
    expect(HiveWorkflowCaseSessionPageSchema.safeParse(value).success).toBe(false)
    const grouped = response()
    grouped.history.page.items = Array.from({ length: 50 }, (_, index) => ({
      ...grouped.history.page.items[0],
      itemId: `row-${index}`,
      sequenceIndex: index
    }))
    expect(HiveWorkflowCaseSessionPageSchema.safeParse(grouped).success).toBe(true)
  })
})
