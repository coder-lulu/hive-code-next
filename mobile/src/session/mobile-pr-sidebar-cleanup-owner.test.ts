import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'

const reads = vi.hoisted(() => ({ pr: vi.fn() }))
vi.mock('./github-pr-rpc', () => ({
  fetchGithubRepoSlug: vi.fn(async () => ({ ok: true, result: null })),
  fetchHostedReviewForBranch: vi.fn(async () => ({ ok: true, result: null })),
  fetchPRForBranch: reads.pr,
  fetchPRChecks: vi.fn(async () => ({ ok: true, result: [] })),
  fetchWorkItemDetails: vi.fn(async () => ({ ok: true, result: null }))
}))
import {
  useMobilePrSidebarController,
  type MobilePrSidebarController
} from './use-mobile-pr-sidebar-controller'

const dto = {
  id: 'w',
  hostId: 'local',
  instanceId: 'i1',
  linkedPR: 7,
  suppressedGitHubPR: null,
  branch: 'feature',
  head: 'head',
  isBare: false,
  isArchived: false
}
const stalePR = {
  number: 7,
  state: 'merged',
  headSha: 'old',
  headDivergedFromMergedPRAtOid: 'head'
}
let current: MobilePrSidebarController
function Harness(props: Parameters<typeof useMobilePrSidebarController>[0]) {
  current = useMobilePrSidebarController(props)
  return null
}
let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  reads.pr.mockReset()
})
function transport() {
  let state: ConnectionState = 'connected'
  let generation = 1
  let connectedAt = 1
  const listeners = new Set<(state: ConnectionState) => void>()
  const sendRequest = vi.fn(async (_method: string) => ({
    id: 'r',
    ok: true,
    result: { worktree: dto }
  }))
  // The hook only uses these transport/lifetime methods; other client methods are unreachable.
  const client = {
    sendRequest,
    getState: () => state,
    getGeneration: () => generation,
    getLastConnectedAt: () => connectedAt,
    onStateChange: (fn: (state: ConnectionState) => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    }
  } as unknown as RpcClient
  return {
    client,
    sendRequest,
    reconnect: () => {
      state = 'reconnecting'
      listeners.forEach((fn) => fn(state))
      state = 'connected'
      connectedAt++
      listeners.forEach((fn) => fn(state))
    },
    migrate: () => {
      generation++
    }
  }
}
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('sidebar cleanup caller ownership', () => {
  it.each(['worktree', 'branch', 'client', 'reconnect', 'generation', 'unmount'] as const)(
    'rejects pending cleanup after %s change',
    async (change) => {
      const t = transport()
      let resolvePR!: (value: unknown) => void
      reads.pr.mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePR = resolve
        })
      )
      const props = {
        client: t.client,
        connState: 'connected' as const,
        worktreeId: 'w',
        branch: 'feature',
        headSha: 'head'
      }
      await act(async () => {
        renderer = create(createElement(Harness, props))
      })
      let pending!: Promise<void>
      act(() => {
        pending = current.refetchPRSidebar({ includeDetails: false })
      })
      await flush()
      expect(reads.pr).toHaveBeenCalledTimes(1)
      act(() => {
        if (change === 'reconnect') {
          t.reconnect()
        } else if (change === 'generation') {
          t.migrate()
        } else if (change === 'unmount') {
          renderer?.unmount()
        } else {
          renderer?.update(
            createElement(Harness, {
              ...props,
              ...(change === 'client'
                ? { client: transport().client }
                : change === 'branch'
                  ? { branch: 'other' }
                  : { worktreeId: 'other' })
            })
          )
        }
      })
      await act(async () => {
        resolvePR({ ok: true, result: stalePR })
        await pending
      })
      expect(t.sendRequest.mock.calls.some((args) => args[0] === 'worktree.set')).toBe(false)
      expect(current.prSidebarState.kind).not.toBe('ready')
    }
  )
})
