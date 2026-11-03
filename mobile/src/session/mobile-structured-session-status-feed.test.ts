import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionStatusSummary } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { createStableLogicalRpcClient } from '../transport/stable-logical-rpc-client'
import { mobileStructuredSessionStatusFeed } from './mobile-structured-session-status-feed'

const REFUSAL = "Method 'agentSession.subscribeStatus' is not available to mobile clients"
const FORBIDDEN = {
  type: 'error',
  message: REFUSAL,
  error: { code: 'forbidden', message: REFUSAL }
}

function summary(stopping: boolean): AgentSessionStatusSummary {
  return {
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    agent: 'codex',
    status: 'working',
    latestPrompt: 'ship it',
    updatedAt: 1,
    hostExecutionOwned: true,
    ...(stopping ? { stopping: true } : {})
  }
}

describe("the phone's status stream", () => {
  let frames: ((value: unknown) => void)[]
  let stateListeners: ((state: ConnectionState) => void)[]
  let client: RpcClient

  beforeEach(() => {
    frames = []
    stateListeners = []
    // A fresh client per test: the stream is one per client for its life.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the feed reaches the client only through subscribe and onStateChange.
    client = {
      subscribe: vi.fn((_method: string, _params: unknown, onData: (value: unknown) => void) => {
        frames.push(onData)
        return () => {}
      }),
      onStateChange: (listener: (state: ConnectionState) => void) => {
        stateListeners.push(listener)
        return () => {}
      }
    } as unknown as RpcClient
  })

  function read(): AgentSessionStatusSummary | undefined {
    return mobileStructuredSessionStatusFeed(client).getSnapshot().get('session-1')
  }

  function connection(state: ConnectionState): void {
    for (const listener of stateListeners) {
      listener(state)
    }
  }

  it('opens one stream per client however many chats read it', () => {
    const feed = mobileStructuredSessionStatusFeed(client)
    feed.subscribe(() => {})
    mobileStructuredSessionStatusFeed(client).subscribe(() => {})

    expect(client.subscribe).toHaveBeenCalledOnce()
    expect(client.subscribe).toHaveBeenCalledWith(
      'agentSession.subscribeStatus',
      {},
      expect.any(Function)
    )
  })

  it('publishes conversation names without inventing live ownership', () => {
    const feed = mobileStructuredSessionStatusFeed(client)
    const listener = vi.fn()
    feed.subscribe(listener)
    frames[0]?.({
      type: 'snapshot',
      sessions: [],
      conversationNames: [{ sessionId: 'session-1', conversationName: 'Reviewed launch' }],
      namingActiveSessionIds: []
    })
    expect(feed.getNamingSnapshot().get('session-1')?.conversationName).toBe('Reviewed launch')
    expect(feed.getSnapshot().has('session-1')).toBe(false)
    expect(feed.getAssociationRevision()).toBe(0)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('invalidates history queries when the host changes a provider association', () => {
    const feed = mobileStructuredSessionStatusFeed(client)
    feed.subscribe(() => {})
    const session = { ...summary(false), providerSession: { key: 'codex', id: 'first' } }
    frames[0]?.({ type: 'snapshot', sessions: [session] })
    const original = feed.getAssociationRevision()
    frames[0]?.({ type: 'status', session })
    expect(feed.getAssociationRevision()).toBe(original)
    frames[0]?.({
      type: 'status',
      session: { ...session, providerSession: { key: 'codex', id: 'second' } }
    })
    expect(feed.getAssociationRevision()).toBe(original + 1)
    connection('reconnecting')
    connection('connected')
    frames[0]?.({ type: 'snapshot', sessions: [] })
    expect(feed.getAssociationRevision()).toBe(original + 2)
  })

  it("follows the host's Stopping from the snapshot through each status frame", () => {
    const listener = vi.fn()
    mobileStructuredSessionStatusFeed(client).subscribe(listener)

    frames[0]?.({ type: 'snapshot', sessions: [summary(true)] })
    expect(read()?.stopping).toBe(true)

    frames[0]?.({ type: 'status', session: summary(false) })
    expect(read()).toMatchObject({ status: 'working' })
    expect(read()).not.toHaveProperty('stopping')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('drops Stopping when the host ends the stream, and opens it again on the next connection', () => {
    mobileStructuredSessionStatusFeed(client).subscribe(() => {})
    frames[0]?.({ type: 'snapshot', sessions: [summary(true)] })

    frames[0]?.({ type: 'end' })

    expect(read()).not.toHaveProperty('stopping')
    connection('connected')
    expect(client.subscribe).toHaveBeenCalledTimes(2)
  })

  it('drops Stopping, keeping the rest, once the phone loses contact', () => {
    mobileStructuredSessionStatusFeed(client).subscribe(() => {})
    frames[0]?.({ type: 'snapshot', sessions: [summary(true)] })

    connection('reconnecting')

    expect(read()).toMatchObject({ sessionId: 'session-1', status: 'working' })
    expect(read()).not.toHaveProperty('stopping')
    expect(read()).not.toHaveProperty('hostExecutionOwned')
  })

  it('requires a fresh runtime permission report after disconnect and reconnect at the same fence', () => {
    mobileStructuredSessionStatusFeed(client).subscribe(() => {})
    const current = {
      ...summary(false),
      permissionMode: 'own',
      runtimePermission: { fence: 3, mode: 'full-access' }
    }
    frames[0]?.({ type: 'snapshot', sessions: [current] })
    expect(read()?.runtimePermission).toEqual(current.runtimePermission)
    connection('reconnecting')
    expect(read()).not.toHaveProperty('runtimePermission')
    expect(read()?.permissionMode).toBe('own')
    connection('connected')
    frames[0]?.({ type: 'snapshot', sessions: [] })
    expect(read()).not.toHaveProperty('runtimePermission')
    frames[0]?.({ type: 'status', session: current })
    expect(read()?.runtimePermission).toEqual(current.runtimePermission)
  })

  it.each([{ type: 'end' }, FORBIDDEN])(
    'revokes runtime permission when the feed closes: %j',
    (ending) => {
      mobileStructuredSessionStatusFeed(client).subscribe(() => {})
      frames[0]?.({
        type: 'snapshot',
        sessions: [
          {
            ...summary(false),
            permissionMode: 'own',
            runtimePermission: { fence: 2, mode: 'full-access' }
          }
        ]
      })
      frames[0]?.(ending)
      expect(read()).not.toHaveProperty('runtimePermission')
      expect(read()?.permissionMode).toBe('own')
    }
  )

  it('reads a host that refuses the method to phones as one without it, asking once per connection', () => {
    mobileStructuredSessionStatusFeed(client).subscribe(() => {})

    // As the host's mobile gate answers it, through the client's failed-opener frame.
    frames[0]?.(FORBIDDEN)
    connection('connected')
    mobileStructuredSessionStatusFeed(client).subscribe(() => {})
    expect(client.subscribe).toHaveBeenCalledOnce()
    expect(read()).toBeUndefined()

    // A new connection may reach a host updated meanwhile.
    connection('reconnecting')
    connection('connected')
    expect(client.subscribe).toHaveBeenCalledTimes(2)
  })
})

/** A physical session as the logical client sees it; a finished stream is dropped before its
 *  listener hears the last frame, as the client's stream registry does. */
class PhysicalSession implements RpcClient {
  readonly sendRequest = vi.fn<RpcClient['sendRequest']>()
  readonly updateTerminalSubscriptionViewport = vi.fn()
  readonly notifyForeground = vi.fn()
  readonly close = vi.fn()
  readonly streams = new Set<(value: unknown) => void>()
  /** Set: the opener fails inside `subscribe`, as a send that cannot reach the socket does. */
  failOnOpen: unknown = null
  readonly subscribe = vi.fn<RpcClient['subscribe']>((_method, _params, listener) => {
    if (this.failOnOpen !== null) {
      listener(this.failOnOpen)
      return () => {}
    }
    this.streams.add(listener)
    return () => this.streams.delete(listener)
  })
  getState = (): ConnectionState => 'connected'
  getReconnectAttempt = (): number => 0
  getLastConnectedAt = (): number | null => null
  onStateChange = (): (() => void) => () => {}

  finish(frame: unknown): void {
    const finished = [...this.streams]
    this.streams.clear()
    for (const listener of finished) {
      listener(frame)
    }
  }

  statusSubscribes(): number {
    return this.subscribe.mock.calls.filter(([method]) => method === 'agentSession.subscribeStatus')
      .length
  }
}

describe("the phone's status stream across the logical client's sessions", () => {
  it('revokes the previous generation before the replacement publishes current authority', async () => {
    const first = new PhysicalSession()
    const logical = createStableLogicalRpcClient(first, 'lan')
    const feed = mobileStructuredSessionStatusFeed(logical)
    feed.subscribe(() => {})
    const current = { ...summary(false), runtimePermission: { fence: 1, mode: 'full-access' } }
    for (const listener of first.streams) {
      listener({ type: 'snapshot', sessions: [current] })
    }
    expect(feed.getSnapshot().get('session-1')?.runtimePermission).toEqual(
      current.runtimePermission
    )
    const next = new PhysicalSession()
    await logical.migrateTo(next, 'relay')
    expect(feed.getSnapshot().get('session-1')).not.toHaveProperty('runtimePermission')
    for (const listener of next.streams) {
      listener({ type: 'snapshot', sessions: [] })
    }
    expect(feed.getSnapshot().get('session-1')).not.toHaveProperty('runtimePermission')
    for (const listener of next.streams) {
      listener({ type: 'status', session: current })
    }
    expect(feed.getSnapshot().get('session-1')?.runtimePermission).toEqual(
      current.runtimePermission
    )
    logical.close()
  })
  it('never replays a refused stream when the client moves to another session', async () => {
    const first = new PhysicalSession()
    const logical = createStableLogicalRpcClient(first, 'lan')
    mobileStructuredSessionStatusFeed(logical).subscribe(() => {})
    first.finish(FORBIDDEN)

    const next = new PhysicalSession()
    await logical.migrateTo(next, 'relay')

    expect(first.statusSubscribes()).toBe(1)
    expect(next.statusSubscribes()).toBe(0)
  })

  it('holds exactly one host stream after an ended stream and a move to another session', async () => {
    const first = new PhysicalSession()
    const logical = createStableLogicalRpcClient(first, 'lan')
    mobileStructuredSessionStatusFeed(logical).subscribe(() => {})
    first.finish({ type: 'end' })

    const next = new PhysicalSession()
    await logical.migrateTo(next, 'relay')

    expect(next.statusSubscribes()).toBe(1)
    expect(next.streams.size).toBe(1)
  })

  it('releases a stream that failed while it was being opened', async () => {
    const first = new PhysicalSession()
    first.failOnOpen = { type: 'error', message: 'Connection interrupted' }
    const logical = createStableLogicalRpcClient(first, 'lan')
    mobileStructuredSessionStatusFeed(logical).subscribe(() => {})

    const next = new PhysicalSession()
    await logical.migrateTo(next, 'relay')

    expect(next.statusSubscribes()).toBe(1)
  })
})
