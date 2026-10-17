import { createElement, useState } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('expo-router', () => ({ useFocusEffect: () => {} }))
vi.mock('react-native', () => ({}))
vi.mock('../transport/host-removal-lifecycle', () => ({ removeHostAndCloseClient: async () => {} }))
vi.mock('../host-route-exit', () => ({ leaveHostRoute: () => {} }))
vi.mock('../cache/worktree-cache', () => ({
  getCachedWorktrees: () => null,
  setCachedWorktrees: () => {}
}))
vi.mock('../storage/preferences', () => ({ savePinnedIds: async () => {} }))
vi.mock('../worktree/host-worktree-refresh', () => ({ startHostWorktreeRefresh: () => () => {} }))
vi.mock('../transport/use-worktree-resync', () => ({
  useWorktreeResync: () => ({ refreshing: false, onRefresh: async () => {} })
}))

import { MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY } from '../../../src/shared/mobile-desktop-relay-contract'
import { FakeSession } from '../transport/mobile-endpoint-supervisor-test-fakes'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { readVisibleHostIds } from '../worktree/visible-host-rows'
import type { Worktree } from '../worktree/workspace-list-types'
import { useHostDisplayWorktrees } from './use-host-display-worktrees'
import { useHostScreenState } from './use-host-screen-state'
import { useHostWorktreeActions } from './use-host-worktree-actions'
import { useHostWorktreeCatalog } from './use-host-worktree-catalog'

const RELAYS = [MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY]

function reply(result: unknown): RpcResponse {
  return { id: 'reply', ok: true, result, _meta: { runtimeId: 'runtime' } }
}

function row(worktreeId: string, hostId?: string): Record<string, unknown> {
  return {
    worktreeId,
    repoId: `repo-${worktreeId}`,
    hostId,
    repo: worktreeId,
    branch: 'main',
    displayName: worktreeId,
    path: `/w/${worktreeId}`,
    liveTerminalCount: 0,
    hasAttachedPty: false,
    preview: '',
    unread: false,
    isPinned: false,
    linkedPR: null
  }
}

const HOSTS = [
  { hostId: 'runtime:vm', label: 'VM', health: 'available', relay: 'ready' },
  { hostId: 'runtime:old', label: 'ThinkPad', health: 'available', relay: 'update-needed' }
]

type Desktop = {
  hostWorktrees?: (hostId: string) => unknown
  carriesRpcEnvelope?: boolean
}

function desktop({ hostWorktrees, carriesRpcEnvelope }: Desktop = {}): FakeSession {
  const client = new FakeSession('connected')
  if (carriesRpcEnvelope !== undefined) {
    Object.assign(client, { carriesRpcEnvelope: () => carriesRpcEnvelope })
  }
  client.sendRequest.mockImplementation(async (method: string, params?: unknown) => {
    switch (method) {
      case 'worktree.ps':
        return reply({ worktrees: [row('mac-wt', 'local')], snapshotId: 's1' })
      case 'mobileRelay.hosts.list':
        return reply({ hosts: HOSTS })
      case 'mobileRelay.hosts.worktrees': {
        const { hostId } = z.object({ hostId: z.string() }).parse(params)
        const result = hostWorktrees
          ? hostWorktrees(hostId)
          : { worktrees: [row(`${hostId}-wt`, hostId)] }
        if (result instanceof Error) {
          throw result
        }
        return reply(result)
      }
      default:
        return reply({})
    }
  })
  return client
}

type Screen = {
  inject: (rows: Worktree[]) => void
  rows: () => Worktree[]
  poll: () => Promise<void>
  hideHosts: (ids: string[]) => void
  open: (worktreeId: string) => void
  catalogError: () => string | null
  pin: (worktreeId: string) => void
  sleep: (worktreeId: string) => void
  slept: () => ReadonlySet<string> | undefined
  swapClient: (next: RpcClient) => Promise<void>
  navigations: string[]
}

async function mountScreen(first: RpcClient, _hostCapabilities: string[]): Promise<Screen> {
  let client = first
  let rerender: (() => void) | null = null
  const navigations: string[] = []
  const router = { push: (to: string) => navigations.push(to), replace: () => {} }
  const held: {
    rows: Worktree[]
    state?: ReturnType<typeof useHostScreenState>
    fetch?: () => Promise<void>
    actions?: ReturnType<typeof useHostWorktreeActions>
  } = { rows: [] }
  function Probe(): null {
    const [, setTick] = useState(0)
    rerender = () => setTick((tick) => tick + 1)
    const state = useHostScreenState('host-1', undefined)
    state.clientRef.current = client
    const catalog = useHostWorktreeCatalog({
      client,
      connState: 'connected',
      embedded: true,
      fetchRepoMetadata: async () => {},
      hostId: 'host-1',
      state,
      syncViewSettingsFromDesktop: async () => {}
    })
    held.actions = useHostWorktreeActions({
      client,
      canRemoveHost: true,
      connState: 'connected',
      embedded: false,
      fetchWorktrees: catalog.fetchWorktrees,
      forgetHostClient: () => {},
      hostId: 'host-1',
      pathname: '/h/host-1',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the actions only push and replace.
      router: router as unknown as Parameters<typeof useHostWorktreeActions>[0]['router'],
      state
    })
    held.state = state
    held.fetch = catalog.fetchWorktrees
    held.rows = useHostDisplayWorktrees('connected', state, 'host-1')
    return null
  }
  await act(async () => {
    create(createElement(Probe))
  })
  const poll = async (): Promise<void> => {
    await act(async () => {
      await held.fetch?.()
      await vi.waitFor(() => expect(held.state?.fetchWorktreesInFlightRef.current).toBe(false))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  await poll()
  return {
    inject: (rows) => act(() => held.state?.setWorktrees(rows)),
    rows: () => held.rows,
    poll,
    hideHosts: (ids) => act(() => held.state?.setVisibleHostIds(readVisibleHostIds(ids))),
    open: (worktreeId) =>
      act(() => {
        const item = held.rows.find((entry) => entry.worktreeId === worktreeId)
        held.actions?.openWorktreeSession(item!)
      }),
    catalogError: () => held.state?.catalogError ?? null,
    pin: (worktreeId) =>
      act(() => {
        held.actions?.togglePin(held.rows.find((entry) => entry.worktreeId === worktreeId)!)
      }),
    sleep: (worktreeId) =>
      act(() => {
        held.actions?.putWorktreeToSleep(
          held.rows.find((entry) => entry.worktreeId === worktreeId)!
        )
      }),
    slept: () => held.state?.sleptIds,
    swapClient: async (next) => {
      client = next
      await act(async () => rerender?.())
    },
    navigations
  }
}

function listed(rows: Worktree[]): [string, string | undefined, string | undefined][] {
  return rows.map((entry) => [entry.worktreeId, entry.hostId, entry.hostContextHealthLabel])
}

function calledMethods(client: FakeSession): string[] {
  return client.sendRequest.mock.calls.map(([method]) => method)
}

describe("a desktop's server workspaces on the phone", () => {
  it('keeps showing today’s view under an older desktop or an older shell', async () => {
    const oldDesktop = desktop()
    const oldShell = desktop({ carriesRpcEnvelope: false })
    for (const [client, capabilities] of [
      [oldDesktop, []],
      [oldShell, RELAYS]
    ] as const) {
      const screen = await mountScreen(client, [...capabilities])
      expect(listed(screen.rows())).toEqual([['mac-wt', 'local', undefined]])
      expect(calledMethods(client).filter((method) => method.startsWith('mobileRelay.'))).toEqual(
        []
      )
    }
  })

  it('sleeps a desktop workspace on the desktop and shows it slept at once', async () => {
    const client = desktop()
    const screen = await mountScreen(client, RELAYS)
    screen.sleep('mac-wt')
    expect(client.sendRequest).toHaveBeenCalledWith('worktree.sleep', { worktree: 'id:mac-wt' })
    expect(screen.slept()?.size).toBe(1)
  })
})

it('never discovers deferred delegated hosts even when a peer advertises the capability', async () => {
  const client = desktop()
  const screen = await mountScreen(client, RELAYS)
  await screen.poll()
  expect(calledMethods(client)).toContain('worktree.ps')
  expect(calledMethods(client).filter((method) => method.startsWith('mobileRelay.hosts.'))).toEqual(
    []
  )
})

it('preserves hidden-host filtering and restores the local catalog when visible again', async () => {
  const screen = await mountScreen(desktop(), RELAYS)
  screen.hideHosts(['ssh:other'])
  expect(screen.rows()).toEqual([])
  screen.hideHosts(['local'])
  expect(screen.rows().map((entry) => entry.worktreeId)).toEqual(['mac-wt'])
})

it('refreshes the selected host on a replacement client without delegated discovery', async () => {
  const screen = await mountScreen(desktop(), RELAYS)
  const next = desktop()
  await screen.swapClient(next)
  await screen.poll()
  expect(calledMethods(next)).toContain('worktree.ps')
  expect(calledMethods(next).some((method) => method.startsWith('mobileRelay.hosts.'))).toBe(false)
  expect(screen.rows().map((entry) => entry.worktreeId)).toEqual(['mac-wt'])
})

it('does not activate, pin or sleep a stale delegated row on the current account client', async () => {
  const client = desktop()
  const screen = await mountScreen(client, RELAYS)
  const local = screen.rows()[0]!
  screen.inject([{ ...local, worktreeId: 'stale', hostId: 'runtime:other' }])
  client.sendRequest.mockClear()
  screen.open('stale')
  screen.pin('stale')
  screen.sleep('stale')
  expect(calledMethods(client).filter((method) => method.startsWith('worktree.'))).toEqual([])
  expect(screen.navigations).toEqual([])
})
