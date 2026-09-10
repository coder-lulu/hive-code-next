// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import type {
  AgentSessionHistoryPage,
  AgentSessionStatusSummary
} from '../../../../shared/agent-session-wire'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../shared/agent-status-types'
import type { Tab } from '../../../../shared/tab-types'
import {
  runtimeTargetForExecutionHostId,
  type RuntimeClientTarget
} from '@/runtime/runtime-client-target'
import type { SessionListItem } from './session-list-types'

const mocks = vi.hoisted(() => ({
  tabs: {} as Record<string, Tab[]>,
  call: vi.fn(),
  subscribe: vi.fn(),
  subscribeStatus: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ unifiedTabsByWorktree: mocks.tabs }) }
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  runtimeEnvironmentSupportsCapability: () => Promise.resolve(true)
}))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call,
  subscribeStructuredAgentSession: mocks.subscribe,
  subscribeStructuredAgentSessionStatus: mocks.subscribeStatus
}))

import {
  getExistingStructuredAgentSessionReadOwner,
  getStructuredAgentSessionReadOwner,
  resetStructuredAgentSessionReadOwnersForTests
} from '../native-chat/structured-agent-session-read-owner'
import {
  getStructuredAgentSessionStatusFeed,
  resetStructuredAgentSessionStatusFeedsForTests
} from '@/runtime/structured-agent-session-status-feed'
import { useSessionJournalStatuses } from './use-session-journal-statuses'

const LOCAL = { kind: 'local' } as const
const INITIAL_NOW = 2_000_000

function item(host: ExecutionHostId = 'local', sessionId = 'session-1'): SessionListItem {
  const bucket = `${host}|workspace`
  const tabId = `tab-${sessionId}`
  const tab: Tab = {
    id: tabId,
    entityId: sessionId,
    worktreeId: 'workspace',
    groupId: 'group',
    contentType: 'agent-session',
    executionHostId: host,
    agentSessionAgent: 'codex',
    label: 'Conversation',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 10
  }
  mocks.tabs[bucket] = [...(mocks.tabs[bucket] ?? []), tab]
  return {
    key: `${bucket}|${tabId}`,
    id: sessionId,
    title: 'Conversation',
    kind: 'structured',
    ownerBucketKey: bucket,
    worktreeId: 'workspace',
    unifiedTabId: tabId,
    tabId,
    terminalTabId: null,
    paneKey: null,
    providerSessionId: null,
    agent: 'codex',
    groupId: 'group',
    projectKey: null,
    projectLabel: null,
    workspaceLabel: 'Workspace',
    workspacePath: '/workspace',
    executionHostId: host,
    hostLabel: host,
    lastActivityAt: 10,
    status: {
      activity: 'unknown',
      reason: null,
      lastActivityAt: null,
      connection: 'connected',
      execution: 'unverifiable',
      executionReason: null
    }
  }
}

function summary(
  status: AgentSessionStatusSummary['status'] = 'working'
): AgentSessionStatusSummary {
  return {
    sessionId: 'session-1',
    workspaceId: 'workspace',
    agent: 'codex',
    status,
    updatedAt: 100,
    latestPrompt: ''
  }
}

function page(body: AgentJournalRenderItem['body']): AgentSessionHistoryPage {
  const cursor = { epoch: 'epoch-1', sequence: 1 }
  return {
    sessionId: 'session-1',
    epoch: cursor.epoch,
    direction: 'tail',
    fence: 1,
    items: [{ itemId: 'item-1', revision: 1, sequence: 1, observedAt: 200, body }],
    submissions: [],
    removedItemIds: [],
    window: { oldest: cursor, newest: cursor, nextCursor: cursor },
    liveCursor: cursor,
    hasOlder: false,
    hasNewer: false
  }
}

async function activateHost(target: RuntimeClientTarget = LOCAL): Promise<void> {
  await act(async () => {
    getStructuredAgentSessionStatusFeed(target).activate()
    await vi.advanceTimersByTimeAsync(0)
  })
}

function emitSummary(value: AgentSessionStatusSummary, target: RuntimeClientTarget = LOCAL): void {
  const call = mocks.subscribeStatus.mock.calls.find(
    ([candidate]) => JSON.stringify(candidate) === JSON.stringify(target)
  )
  if (!call) {
    throw new Error('Missing host bridge fixture')
  }
  call[1]({ type: 'status', session: value })
}

describe('session list journal and host-summary projection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(INITIAL_NOW)
    mocks.tabs = {}
    mocks.call.mockReset()
    mocks.subscribe.mockReset().mockResolvedValue({ unsubscribe: vi.fn() })
    mocks.subscribeStatus.mockReset().mockResolvedValue({ unsubscribe: vi.fn() })
  })
  afterEach(() => {
    cleanup()
    resetStructuredAgentSessionReadOwnersForTests()
    resetStructuredAgentSessionStatusFeedsForTests()
    vi.useRealTimers()
  })

  it('does not instantiate readers or activate streams for unselected inventory', () => {
    const items = Array.from({ length: 100 }, (_, index) => item('local', `session-${index}`))
    const view = renderHook(() => useSessionJournalStatuses(items))
    expect(view.result.current).toBe(items)
    expect(getExistingStructuredAgentSessionReadOwner('session-1', LOCAL)).toBeNull()
    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(mocks.subscribeStatus).not.toHaveBeenCalled()
  })

  it('isolates identical session ids on local and remote hosts', async () => {
    const remote = runtimeTargetForExecutionHostId('runtime:cloud')!
    const items = [item(), item('runtime:cloud')]
    await activateHost()
    await activateHost(remote)
    act(() => {
      emitSummary(summary('working'))
      emitSummary(summary('attention'), remote)
    })
    const view = renderHook(() => useSessionJournalStatuses(items))
    expect(view.result.current.map((row) => row.status.activity)).toEqual(['running', 'waiting'])
    expect(mocks.subscribeStatus).toHaveBeenCalledTimes(2)
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })

  it('uses a fresh journal approval, then falls back to a fresh neutral summary after expiry', async () => {
    const items = [item()]
    await activateHost()
    act(() => emitSummary(summary('attention')))
    const view = renderHook(() => useSessionJournalStatuses(items))
    expect(view.result.current[0].status.activity).toBe('waiting')
    mocks.call.mockResolvedValue({
      ok: true,
      page: page({
        kind: 'approval',
        title: 'Run command',
        detail: null,
        options: [],
        resolution: { state: 'pending', selectedOptionId: null, resolvedAt: null, resolvedBy: null }
      })
    })
    await act(async () => {
      getStructuredAgentSessionReadOwner('session-1', LOCAL).activate()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(view.result.current[0].status.activity).toBe('permission')
    const activityAt = view.result.current[0].lastActivityAt
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_STATUS_STALE_AFTER_MS / 2)
      emitSummary(summary('attention'))
      await vi.advanceTimersByTimeAsync(AGENT_STATUS_STALE_AFTER_MS / 2 + 1)
    })
    expect(view.result.current[0].status.activity).toBe('waiting')
    expect(view.result.current[0].lastActivityAt).toBe(activityAt)
    expect(mocks.call).toHaveBeenCalledOnce()
    expect(mocks.subscribe).toHaveBeenCalledOnce()
  })

  it('retains a real rejected-submission error ahead of the coarse idle summary', async () => {
    const items = [item()]
    await activateHost()
    act(() => emitSummary(summary('idle')))
    const view = renderHook(() => useSessionJournalStatuses(items))
    const rejected = page({ kind: 'status', text: '' })
    rejected.submissions = [
      {
        clientMessageId: 'message-1',
        fence: 1,
        payloadFingerprint: 'fingerprint',
        dispatchState: 'rejected',
        providerItemId: null,
        reason: 'Request rejected',
        submittedAt: 201,
        resolvedAt: 202
      }
    ]
    mocks.call.mockResolvedValue({ ok: true, page: rejected })
    await act(async () => {
      getStructuredAgentSessionReadOwner('session-1', LOCAL).activate()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(view.result.current[0].status).toMatchObject({
      activity: 'error',
      reason: 'Request rejected',
      execution: 'unverifiable'
    })
  })

  it('renews heartbeat expiry without rerendering or reordering the list', async () => {
    const items = [item()]
    await activateHost()
    act(() => emitSummary(summary()))
    let renders = 0
    const view = renderHook(() => {
      renders += 1
      return useSessionJournalStatuses(items)
    })
    const before = view.result.current
    const renderCount = renders
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_STATUS_STALE_AFTER_MS / 2)
      emitSummary(summary())
      await vi.advanceTimersByTimeAsync(AGENT_STATUS_STALE_AFTER_MS / 2 + 1)
    })
    expect(view.result.current).toBe(before)
    expect(renders).toBe(renderCount)
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_STATUS_STALE_AFTER_MS / 2))
    expect(view.result.current[0].status.activity).toBe('unknown')
    expect(view.result.current[0].lastActivityAt).toBe(before[0].lastActivityAt)
    expect(mocks.subscribeStatus).toHaveBeenCalledOnce()
  })

  it('suppresses transcript-only revisions that do not change list activity', async () => {
    const items = [item()]
    const current = page({
      kind: 'status',
      text: '',
      turnLifecycle: { turnId: 'turn-1', state: 'running' }
    })
    mocks.call.mockResolvedValue({ ok: true, page: current })
    await act(async () => {
      getStructuredAgentSessionReadOwner('session-1', LOCAL).activate()
      await vi.advanceTimersByTimeAsync(0)
    })
    let renders = 0
    const view = renderHook(() => {
      renders += 1
      return useSessionJournalStatuses(items)
    })
    const before = view.result.current
    const count = renders
    await act(async () => {
      mocks.subscribe.mock.calls[0][2]({
        type: 'batch',
        sessionId: 'session-1',
        batch: {
          cursor: { epoch: 'epoch-1', sequence: 2 },
          submissions: [],
          removedItemIds: [],
          items: [{ ...current.items[0], revision: 2 }]
        }
      })
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(view.result.current).toBe(before)
    expect(renders).toBe(count)
  })

  it('ignores foreign workspace and stale-provider summaries without changing ordering', async () => {
    const items = [{ ...item(), providerSessionId: 'expected-provider' }]
    await activateHost()
    act(() => emitSummary({ ...summary(), workspaceId: 'elsewhere', updatedAt: INITIAL_NOW }))
    const view = renderHook(() => useSessionJournalStatuses(items))
    expect(view.result.current[0].status.activity).toBe('unknown')
    expect(view.result.current[0].lastActivityAt).toBe(10)
    act(() =>
      emitSummary({ ...summary(), providerSession: { key: 'session_id', id: 'other-provider' } })
    )
    expect(view.result.current[0].status.activity).toBe('unknown')
    expect(view.result.current[0].lastActivityAt).toBe(10)
  })
})
