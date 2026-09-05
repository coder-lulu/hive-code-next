import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, RpcResponse } from '../transport/types'
import { useMobileLocalTasks, type MobileLocalTaskFeed } from './mobile-local-task-hook'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((done) => {
      resolve = done
    }),
    resolve
  }
}

function success(result: unknown): RpcResponse {
  return {
    id: 'response-1',
    ok: true,
    result,
    _meta: { runtimeId: 'runtime-1' }
  }
}

function sessionSnapshot(worktree: string, paneKey: string, prompt: string) {
  return {
    worktree,
    publicationEpoch: 'epoch-1',
    snapshotVersion: 1,
    activeGroupId: null,
    activeTabId: 'tab-1',
    activeTabType: 'terminal',
    tabs: [
      {
        type: 'terminal',
        id: 'terminal-1',
        parentTabId: 'tab-1',
        title: prompt,
        agentStatus: {
          state: 'working',
          prompt,
          updatedAt: 2_000,
          stateStartedAt: 1_000,
          paneKey,
          agentType: 'codex',
          stateHistory: []
        }
      }
    ]
  }
}

function makeClient() {
  const list = deferred<RpcResponse>()
  const worktrees = deferred<RpcResponse>()
  const unsubscribe = vi.fn()
  let streamListener: ((value: unknown) => void) | null = null
  const sendRequest = vi.fn((method: string) => {
    if (method === 'session.tabs.listAll') {
      return list.promise
    }
    if (method === 'worktree.ps') {
      return worktrees.promise
    }
    throw new Error(`Unexpected method: ${method}`)
  })
  const subscribe = vi.fn(
    (_method: string, _params: unknown, listener: (value: unknown) => void) => {
      streamListener = listener
      return unsubscribe
    }
  )
  return {
    client: { sendRequest, subscribe } as unknown as RpcClient,
    list,
    worktrees,
    sendRequest,
    subscribe,
    unsubscribe,
    emit(value: unknown) {
      streamListener?.(value)
    }
  }
}

function mountFeed(client: RpcClient | null, connectionState: ConnectionState = 'connected') {
  let latest: MobileLocalTaskFeed | null = null

  function Probe(props: { client: RpcClient | null; connectionState: ConnectionState }) {
    latest = useMobileLocalTasks(props)
    return null
  }

  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Probe, { client, connectionState }))
  })
  return {
    get feed(): MobileLocalTaskFeed {
      if (!latest) {
        throw new Error('Hook probe did not render.')
      }
      return latest
    },
    rerender(nextClient: RpcClient | null, nextState: ConnectionState) {
      act(() => {
        renderer.update(createElement(Probe, { client: nextClient, connectionState: nextState }))
      })
    },
    unmount() {
      act(() => renderer.unmount())
    }
  }
}

async function resolveInAct<T>(pending: Deferred<T>, value: T): Promise<void> {
  await act(async () => {
    pending.resolve(value)
    await Promise.resolve()
  })
}

describe('useMobileLocalTasks', () => {
  const mounted: { unmount: () => void }[] = []

  afterEach(() => {
    for (const probe of mounted.splice(0)) {
      probe.unmount()
    }
  })

  it('starts listAll, subscribeAll, and worktree.ps from the connected real RpcClient', async () => {
    const runtime = makeClient()
    const probe = mountFeed(runtime.client)
    mounted.push(probe)

    expect(runtime.subscribe).toHaveBeenCalledWith(
      'session.tabs.subscribeAll',
      null,
      expect.any(Function)
    )
    expect(runtime.sendRequest).toHaveBeenCalledWith('session.tabs.listAll')
    expect(runtime.sendRequest).toHaveBeenCalledWith('worktree.ps', { limit: 10_000 })

    await resolveInAct(
      runtime.list,
      success({
        authoritative: true,
        snapshots: [sessionSnapshot('wt-1', 'tab-1:leaf-1', 'Build local tasks')]
      })
    )
    await resolveInAct(
      runtime.worktrees,
      success({
        worktrees: [
          {
            worktreeId: 'wt-1',
            repo: 'hive-code-next',
            branch: 'mobile-ui',
            displayName: 'Mobile UI',
            agents: [
              {
                paneKey: 'tab-1:leaf-1',
                displayName: 'Local worker',
                taskTitle: 'Real task title',
                agentType: 'codex'
              }
            ]
          }
        ]
      })
    )

    expect(probe.feed.phase).toBe('ready')
    expect(probe.feed.isVerifiable).toBe(true)
    expect(probe.feed.inProgress[0]).toMatchObject({
      title: 'Real task title',
      repo: 'hive-code-next',
      branch: 'mobile-ui',
      agentDisplayName: 'Local worker'
    })
    expect(probe.feed.refresh).toBe(probe.feed.reload)
  })

  it('cleans up the old subscription and ignores its late responses after a client swap', async () => {
    const oldRuntime = makeClient()
    const nextRuntime = makeClient()
    const probe = mountFeed(oldRuntime.client)
    mounted.push(probe)

    probe.rerender(nextRuntime.client, 'connected')
    expect(oldRuntime.unsubscribe).toHaveBeenCalledTimes(1)

    act(() => {
      oldRuntime.emit({
        type: 'updated',
        ...sessionSnapshot('wt-old-stream', 'old-stream-pane', 'Stale stream task')
      })
    })
    await resolveInAct(
      oldRuntime.list,
      success({
        authoritative: true,
        snapshots: [sessionSnapshot('wt-old-list', 'old-list-pane', 'Stale list task')]
      })
    )
    await resolveInAct(oldRuntime.worktrees, success({ worktrees: [] }))

    await resolveInAct(
      nextRuntime.list,
      success({
        authoritative: true,
        snapshots: [sessionSnapshot('wt-next', 'next-pane', 'Current task')]
      })
    )
    await resolveInAct(nextRuntime.worktrees, success({ worktrees: [] }))

    expect(probe.feed.inProgress.map((row) => row.worktreeId)).toEqual(['wt-next'])
    expect(probe.feed.inProgress[0]?.title).toBe('Current task')
  })

  it('retains rows but marks them unverifiable after a stream error or disconnect', async () => {
    const runtime = makeClient()
    const probe = mountFeed(runtime.client)
    mounted.push(probe)
    await resolveInAct(
      runtime.list,
      success({
        authoritative: true,
        snapshots: [sessionSnapshot('wt-1', 'pane-1', 'Retained task')]
      })
    )
    await resolveInAct(runtime.worktrees, success({ worktrees: [] }))

    act(() => runtime.emit({ type: 'error', message: 'subscription lost' }))
    expect(probe.feed.phase).toBe('ready')
    expect(probe.feed.error).toBe('subscription lost')
    expect(probe.feed.isVerifiable).toBe(false)
    expect(probe.feed.inProgress[0]).toMatchObject({
      title: 'Retained task',
      state: 'working',
      verifiable: false
    })

    probe.rerender(runtime.client, 'disconnected')
    expect(runtime.unsubscribe).toHaveBeenCalledTimes(1)
    expect(probe.feed.phase).toBe('disconnected')
    expect(probe.feed.inProgress[0]).toMatchObject({
      title: 'Retained task',
      state: 'working',
      verifiable: false
    })
  })
})
