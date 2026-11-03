// @vitest-environment happy-dom

import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentSessionHistoryPage,
  AgentSessionSubscribeEvent
} from '../../../../shared/agent-session-wire'

const mocks = vi.hoisted(() => ({ call: vi.fn(), subscribe: vi.fn() }))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call,
  subscribeStructuredAgentSession: mocks.subscribe
}))

import {
  getStructuredAgentSessionReadOwner,
  resetStructuredAgentSessionReadOwnersForTests
} from './structured-agent-session-read-owner'

const TARGET = { kind: 'local' } as const
const SESSION_ID = 'session-a'

function page(sequence = 2): AgentSessionHistoryPage {
  const cursor = { epoch: 'epoch-a', sequence }
  return {
    sessionId: SESSION_ID,
    epoch: cursor.epoch,
    direction: 'tail',
    fence: 1,
    items: [
      {
        itemId: 'assistant',
        revision: 1,
        sequence,
        observedAt: 10,
        body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'ready' }] }
      }
    ],
    removedItemIds: [],
    submissions: [],
    window: { oldest: cursor, newest: cursor, nextCursor: cursor },
    liveCursor: cursor,
    hasOlder: false,
    hasNewer: false
  }
}

describe('structured journal receipt evidence', () => {
  beforeEach(() => {
    mocks.call.mockReset()
    mocks.subscribe.mockReset()
    mocks.subscribe.mockResolvedValue({ unsubscribe: vi.fn() })
    mocks.call.mockResolvedValue({ ok: true, page: page() })
  })

  afterEach(() => {
    resetStructuredAgentSessionReadOwnersForTests()
    vi.restoreAllMocks()
  })

  it('lets passive list subscribers observe the same owner without opening a host stream', async () => {
    const owner = getStructuredAgentSessionReadOwner(SESSION_ID, TARGET)
    const listener = vi.fn()
    const unsubscribe = owner.subscribe(listener)
    expect(owner.getSnapshot().receivedAt).toBeNull()
    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()

    const chatOwner = getStructuredAgentSessionReadOwner(SESSION_ID, { kind: 'local' })
    expect(chatOwner).toBe(owner)
    const stop = chatOwner.activate()
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce())
    expect(listener).toHaveBeenCalled()
    expect(owner.getSnapshot().receivedAt).toEqual(expect.any(Number))
    stop()
    unsubscribe()
  })

  it('renews receipt for an unchanged current stream cursor but not stale frames or read errors', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    let onEvent: (event: AgentSessionSubscribeEvent) => void = () => {}
    let onError: (error: unknown) => void = () => {}
    mocks.subscribe.mockImplementation((_target, _params, callback, failed) => {
      onEvent = callback
      onError = failed
      return Promise.resolve({ unsubscribe: vi.fn() })
    })
    const owner = getStructuredAgentSessionReadOwner(SESSION_ID, TARGET)
    owner.activate()
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce())
    expect(owner.getSnapshot().receivedAt).toBe(1_000)
    const items = owner.getSnapshot().state.items
    const batch = (sequence: number): AgentSessionSubscribeEvent => ({
      type: 'batch',
      sessionId: SESSION_ID,
      batch: {
        cursor: { epoch: 'epoch-a', sequence },
        items: [],
        removedItemIds: [],
        submissions: []
      }
    })

    clock.mockReturnValue(2_000)
    onEvent(batch(2))
    await waitFor(() => expect(owner.getSnapshot().receivedAt).toBe(2_000))
    expect(owner.getSnapshot().state.items).toBe(items)

    clock.mockReturnValue(3_000)
    onEvent(batch(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(owner.getSnapshot().receivedAt).toBe(2_000)

    onError(new Error('disconnected'))
    expect(owner.getSnapshot().state.status).toBe('ready')
    expect(owner.getSnapshot().receivedAt).toBe(2_000)
    expect(mocks.call).toHaveBeenCalledOnce()
  })

  it('does not refresh current-state evidence while paging through older history', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const owner = getStructuredAgentSessionReadOwner(SESSION_ID, TARGET)
    const initial = page(500)
    initial.hasOlder = true
    initial.items = Array.from({ length: 300 }, (_, index) => ({
      ...initial.items[0],
      itemId: `message-${index}`,
      sequence: index + 201
    }))
    mocks.call.mockResolvedValueOnce({ ok: true, page: initial })
    owner.activate()
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce())
    expect(owner.getSnapshot().receivedAt).toBe(1_000)
    clock.mockReturnValue(4_000)
    mocks.call.mockResolvedValueOnce({ ok: true, page: { ...page(100), direction: 'before' } })
    await owner.loadOlder()
    expect(owner.getSnapshot().state.items[0]?.sequence).toBe(100)
    expect(owner.getSnapshot().receivedAt).toBe(1_000)
  })

  it('accepts current stream evidence and ignores stale or retired deliveries', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    let onEvent: (event: AgentSessionSubscribeEvent) => void = () => {}
    mocks.subscribe.mockImplementation((_target, _params, callback) => {
      onEvent = callback
      return Promise.resolve({ unsubscribe: vi.fn() })
    })
    const owner = getStructuredAgentSessionReadOwner(SESSION_ID, TARGET)
    const stop = owner.activate()
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce())
    const event: AgentSessionSubscribeEvent = {
      type: 'snapshot',
      sessionId: SESSION_ID,
      page: page(3),
      fence: 1
    }
    clock.mockReturnValue(2_000)
    onEvent(event)
    expect(owner.getSnapshot().receivedAt).toBe(2_000)

    clock.mockReturnValue(3_000)
    onEvent({
      type: 'batch',
      sessionId: SESSION_ID,
      batch: {
        cursor: { epoch: 'old-epoch', sequence: 4 },
        items: [],
        removedItemIds: [],
        submissions: []
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(owner.getSnapshot().receivedAt).toBe(2_000)
    onEvent({ type: 'end' })
    expect(owner.getSnapshot().receivedAt).toBe(2_000)
    stop()
    onEvent({ ...event, page: page(5) })
    expect(owner.getSnapshot().receivedAt).toBe(2_000)
  })

  it('isolates same-session receipts by the execution runtime', async () => {
    const local = getStructuredAgentSessionReadOwner(SESSION_ID, TARGET)
    const remote = getStructuredAgentSessionReadOwner(SESSION_ID, {
      kind: 'environment',
      environmentId: 'remote-a'
    })
    expect(remote).not.toBe(local)
    local.activate()
    await waitFor(() => expect(local.getSnapshot().receivedAt).toEqual(expect.any(Number)))
    expect(remote.getSnapshot().receivedAt).toBeNull()
    expect(remote.getSnapshot().state.items).toHaveLength(0)
  })
})
