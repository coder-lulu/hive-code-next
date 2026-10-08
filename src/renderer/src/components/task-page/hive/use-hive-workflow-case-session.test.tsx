// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import type { HiveWorkflowCaseSessionRead } from '../../../../../shared/hive-workflow-case-session'
import { MAX_TIMER_DELAY_MS } from '../../../../../shared/timer-delay'
import { useHiveWorkflowCaseSession } from './use-hive-workflow-case-session'
import {
  workflowSessionPage,
  workflowSessionQuery
} from './hive-workflow-case-session.test-fixtures'
import {
  deferredWorkbenchValue,
  workbenchAccountState,
  workbenchAccountBoundaryStates,
  workbenchAccountRefreshStates
} from './hive-workbench.test-fixtures'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const api = vi.fn()
const listeners = new Set<(value: HiveAccountState) => void>()
let account: HiveAccountState
let model: ReturnType<typeof useHiveWorkflowCaseSession>
let root: Root, container: HTMLDivElement
function Harness({ query }: { query: HiveWorkflowCaseSessionRead }) {
  model = useHiveWorkflowCaseSession(query)
  return <span>{model.timeline.items.map((item) => item.itemId).join(',')}</span>
}
async function mount(query = workflowSessionQuery()) {
  await act(async () => {
    root.render(<Harness query={query} />)
  })
}
beforeEach(() => {
  api.mockReset().mockImplementation((query) => Promise.resolve(workflowSessionPage(query)))
  listeners.clear()
  account = workbenchAccountState()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveTasks: { getWorkflowCaseSessionPage: api },
      hiveAccount: {
        getState: vi.fn().mockImplementation(() => Promise.resolve(account)),
        onStateChanged: (listener: (value: HiveAccountState) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        }
      }
    }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})
describe('passive original Case session paging lifetime', () => {
  it('reads one tail and joins duplicate refresh and earlier reads', async () => {
    await mount()
    expect(api).toHaveBeenCalledOnce()
    const pending = deferredWorkbenchValue<unknown>()
    api.mockReturnValue(pending.promise)
    await act(async () => {
      void model.refresh()
      void model.refresh()
    })
    expect(api).toHaveBeenCalledTimes(2)
    await act(async () => {
      pending.resolve(workflowSessionPage(workflowSessionQuery(), [41, 42], true))
    })
    const earlier = deferredWorkbenchValue<unknown>()
    api.mockReturnValue(earlier.promise)
    let first!: Promise<string>, second!: Promise<string>
    await act(async () => {
      first = model.loadEarlier()
      second = model.loadEarlier()
    })
    expect(first).toBe(second)
    expect(api).toHaveBeenCalledTimes(3)
    await act(async () => {
      earlier.resolve(workflowSessionPage(api.mock.calls.at(-1)![0], [39, 40], false))
    })
    expect(await first).toBe('applied')
    expect(model.timeline.items.map((item) => item.sequence)).toEqual([39, 40, 41, 42])
    expect(await model.loadEarlier()).toBe('exhausted')
  })
  it('keeps the original identity and does not reload on an equivalent immutable selection', async () => {
    await mount()
    await mount({ ...workflowSessionQuery() })
    expect(api).toHaveBeenCalledOnce()
    api.mockResolvedValue({ ...workflowSessionPage(), workspaceId: 'replacement-workspace' })
    await act(async () => {
      await model.refresh()
    })
    expect(model.error).toBe('INVALID_RESPONSE')
    expect(model.original).toBeNull()
    api.mockResolvedValue({ ...workflowSessionPage(), workspaceId: 'replacement-workspace' })
    await act(async () => {
      await model.refresh()
    })
    expect(model.error).toBe('INVALID_RESPONSE')
  })
  it('clears a switched scope immediately and rejects its late original response', async () => {
    const pending = deferredWorkbenchValue<unknown>()
    api.mockReturnValueOnce(pending.promise)
    api.mockImplementation((query) => Promise.resolve(workflowSessionPage(query, [101])))
    await mount()
    const query = { ...workflowSessionQuery(), runId: '00000000-0000-4000-8000-000000008888' }
    await mount(query)
    await act(async () => {
      pending.resolve(workflowSessionPage())
    })
    expect(model.original?.sessionId).toBe('original-session')
    expect(model.scope).toContain(query.runId)
    expect(api.mock.calls[1][0].runId).toBe(query.runId)
    expect(model.timeline.items.map((item) => item.sequence)).toEqual([101])
  })
  it.each(workbenchAccountBoundaryStates(workbenchAccountState()))(
    'clears private content and rejects late responses at $name boundary',
    async ({ state: next }) => {
      await mount()
      const pending = deferredWorkbenchValue<unknown>()
      api.mockReturnValue(pending.promise)
      await act(async () => {
        void model.refresh()
      })
      await act(async () => {
        listeners.forEach((listener) => listener(next))
        pending.resolve(workflowSessionPage())
      })
      expect(model.original).toBeNull()
      expect(model.timeline.items).toHaveLength(0)
      expect(model.ready).toBe(false)
      expect(model.error).toBe('FORBIDDEN')
      expect(await model.refresh()).toBe('superseded')
    }
  )
  it('retains the current owner snapshot through ordinary token metadata refresh', async () => {
    await mount()
    for (const next of workbenchAccountRefreshStates(account)) {
      await act(async () => {
        listeners.forEach((listener) => listener(next))
      })
    }
    expect(model.original).not.toBeNull()
    expect(model.ready).toBe(true)
    expect(api).toHaveBeenCalledOnce()
  })
  it('clears at exact session expiry and never reads while initially signed out', async () => {
    vi.useFakeTimers()
    account = { ...account, sessionExpiresAt: Date.now() + 100 }
    await mount()
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(model.timeline.items).toHaveLength(0)
    expect(model.ready).toBe(false)
    act(() => root.unmount())
    root = createRoot(container)
    account = { configured: true, status: 'signed-out', persistence: 'none' }
    await mount()
    expect(api).toHaveBeenCalledOnce()
    expect(model.error).toBe('FORBIDDEN')
  })
  it('reauthorizes no page from a stale initial account response after signout', async () => {
    const pending = deferredWorkbenchValue<HiveAccountState>()
    window.api.hiveAccount.getState = vi.fn().mockReturnValue(pending.promise)
    await mount()
    await act(async () => {
      listeners.forEach((listener) =>
        listener({ configured: true, status: 'signed-out', persistence: 'none' })
      )
      pending.resolve(account)
    })
    expect(api).not.toHaveBeenCalled()
    expect(model.ready).toBe(false)
    expect(model.error).toBe('FORBIDDEN')
  })
  it('chunks long expiry timers without revoking an unexpired owner', async () => {
    vi.useFakeTimers()
    account = { ...account, sessionExpiresAt: Date.now() + MAX_TIMER_DELAY_MS + 100 }
    await mount()
    await act(async () => {
      vi.advanceTimersByTime(MAX_TIMER_DELAY_MS)
    })
    expect(model.ready).toBe(true)
    expect(model.timeline.items).toHaveLength(2)
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(model.ready).toBe(false)
    expect(model.timeline.items).toHaveLength(0)
    expect(api).toHaveBeenCalledOnce()
  })
  it('honors a same-owner deadline renewal before the prior expiry effect cleans up', async () => {
    vi.useFakeTimers()
    account = { ...account, sessionExpiresAt: Date.now() + 100 }
    await mount()
    await act(async () => {
      listeners.forEach((listener) => listener({ ...account, sessionExpiresAt: Date.now() + 1000 }))
      vi.advanceTimersByTime(100)
    })
    expect(model.ready).toBe(true)
    expect(model.timeline.items).toHaveLength(2)
    expect(api).toHaveBeenCalledOnce()
    await act(async () => {
      vi.advanceTimersByTime(900)
    })
    expect(model.timeline.items).toHaveLength(0)
  })
  it('bounds automatic page chains while preserving the real hasOlder fact', async () => {
    api.mockImplementation((query) =>
      Promise.resolve(
        workflowSessionPage(
          query,
          [query.direction === 'tail' ? 100 : query.cursor.sequence - 1],
          true
        )
      )
    )
    await mount()
    for (let i = 0; i < 9; i++) {
      await act(async () => {
        expect(await model.loadEarlier()).toBe('applied')
      })
    }
    expect(api).toHaveBeenCalledTimes(10)
    expect(model.limited).toBe(true)
    expect(model.timeline.hasOlder).toBe(true)
    expect(await model.loadEarlier()).toBe('unchanged')
    expect(api).toHaveBeenCalledTimes(10)
  })
  it('applies an authentic epoch reset as a replacement, then stops auto chaining', async () => {
    api.mockResolvedValue(workflowSessionPage(workflowSessionQuery(), [100], true))
    await mount()
    const replacement = workflowSessionPage(workflowSessionQuery(), [2], true, 'new-epoch')
    api.mockResolvedValue({
      ...replacement,
      history: { ...replacement.history, ok: false, reset: 'epoch_changed' }
    })
    await act(async () => {
      expect(await model.loadEarlier()).toBe('unchanged')
    })
    expect(model.timeline.epoch).toBe('new-epoch')
    expect(model.timeline.items.map((item) => item.sequence)).toEqual([2])
    expect(model.timeline.hasOlder).toBe(true)
    expect(model.historyReset).toBe(true)
    expect(await model.loadEarlier()).toBe('unchanged')
    expect(api).toHaveBeenCalledTimes(2)
    api.mockResolvedValue(replacement)
    await act(async () => {
      expect(await model.refresh()).toBe('applied')
    })
    expect(model.historyReset).toBe(false)
  })
  it('reports broken reads and rejects a late disposed response without re-reading', async () => {
    await mount()
    api.mockRejectedValue(new Error('JOURNAL_UNAVAILABLE'))
    await act(async () => {
      expect(await model.refresh()).toBe('failed')
    })
    expect(model.error).toBe('JOURNAL_UNAVAILABLE')
    expect(model.timeline.items).toHaveLength(0)
    const pending = deferredWorkbenchValue<unknown>()
    api.mockReturnValue(pending.promise)
    await act(async () => {
      void model.refresh()
    })
    act(() => root.unmount())
    await act(async () => {
      pending.resolve(workflowSessionPage())
    })
    expect(api).toHaveBeenCalledTimes(3)
    root = createRoot(container)
  })
})
