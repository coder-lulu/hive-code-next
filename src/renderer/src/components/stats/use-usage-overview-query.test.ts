// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUsageOverviewQuery } from './use-usage-overview-query'

const fetchUsage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const subscription = vi.hoisted(() => ({
  listener: undefined as undefined | ((state: unknown, previous: unknown) => void),
  unsubscribe: vi.fn()
}))
vi.mock('../../store', () => ({
  useAppStore: {
    subscribe: (listener: (state: unknown, previous: unknown) => void) => {
      subscription.listener = listener
      return subscription.unsubscribe
    },
    getState: () => ({
      fetchClaudeUsage: fetchUsage,
      fetchCodexUsage: fetchUsage,
      fetchOpenCodeUsage: fetchUsage
    })
  }
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function installApi() {
  const getSnapshot = vi
    .fn()
    .mockImplementation(async (query: { range: string }) => ({ range: query.range }))
  vi.stubGlobal('api', undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      claudeUsage: { getSnapshot },
      codexUsage: { getSnapshot },
      openCodeUsage: { getSnapshot }
    }
  })
  return getSnapshot
}

describe('usage overview query', () => {
  it('updates scan progress without restarting collection', async () => {
    const getSnapshot = installApi()
    renderHook(() => useUsageOverviewQuery('30d', true))
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3))
    act(() =>
      subscription.listener?.(
        { codexUsageScanState: { enabled: true, isScanning: true, lastScanCompletedAt: 1 } },
        { codexUsageScanState: { enabled: true, isScanning: false, lastScanCompletedAt: 1 } }
      )
    )
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(6))
    expect(fetchUsage).toHaveBeenCalledTimes(3)
  })

  it('shows cached Codex usage while source scans are still pending', async () => {
    const getSnapshot = installApi()
    let finishScan!: () => void
    const scan = new Promise<void>((resolve) => {
      finishScan = resolve
    })
    fetchUsage.mockReturnValueOnce(scan).mockReturnValueOnce(scan).mockReturnValueOnce(scan)
    const { result } = renderHook(() => useUsageOverviewQuery('30d', true))
    await waitFor(() => expect(result.current.data?.codex).toEqual({ range: '30d' }))
    expect(result.current.loading).toBe(false)
    expect(getSnapshot).toHaveBeenCalledTimes(3)
    await act(async () => {
      finishScan()
      await scan
    })
    act(() =>
      subscription.listener?.(
        { codexUsageScanState: { enabled: true, isScanning: false, lastScanCompletedAt: 2 } },
        { codexUsageScanState: { enabled: true, isScanning: true, lastScanCompletedAt: 1 } }
      )
    )
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(6))
    expect(fetchUsage).toHaveBeenCalledTimes(3)
  })

  it('coalesces completed source updates and stops listening while hidden', async () => {
    const getSnapshot = installApi()
    const { rerender } = renderHook(({ active }) => useUsageOverviewQuery('7d', active), {
      initialProps: { active: true }
    })
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3))
    act(() => {
      for (const completedAt of [1, 2, 3]) {
        subscription.listener?.(
          {
            claudeUsageScanState: {
              isScanning: false,
              enabled: true,
              lastScanCompletedAt: completedAt
            }
          },
          { claudeUsageScanState: { isScanning: true } }
        )
      }
    })
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(6))
    expect(fetchUsage).toHaveBeenCalledTimes(3)
    rerender({ active: false })
    expect(subscription.unsubscribe).toHaveBeenCalled()
  })
  it('uses one scope and range for every source, without rescanning on filter changes', async () => {
    const getSnapshot = installApi()
    const { result, rerender } = renderHook(
      ({ range }: { range: '7d' | '30d' }) => useUsageOverviewQuery(range, true),
      { initialProps: { range: '7d' } }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(getSnapshot).toHaveBeenCalledTimes(3)
    expect(getSnapshot).toHaveBeenCalledWith({ scope: 'all', range: '7d', limit: 100 })
    expect(fetchUsage).toHaveBeenCalledTimes(3)
    rerender({ range: '30d' })
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(6))
    expect(fetchUsage).toHaveBeenCalledTimes(3)
    expect(getSnapshot).toHaveBeenLastCalledWith({ scope: 'all', range: '30d', limit: 100 })
  })
  it('does not query while hidden and reports unavailable snapshots', async () => {
    const getSnapshot = installApi().mockResolvedValue(undefined)
    const { result, rerender } = renderHook(({ active }) => useUsageOverviewQuery('7d', active), {
      initialProps: { active: false }
    })
    expect(getSnapshot).not.toHaveBeenCalled()
    rerender({ active: true })
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.data).toBeNull()
  })
  it('ignores an older range response that arrives after the new query', async () => {
    const getSnapshot = installApi()
    let release: (value: unknown) => void = () => {}
    const old = new Promise((resolve) => {
      release = resolve
    })
    getSnapshot.mockImplementation((query: { range: string }) =>
      query.range === '7d' ? old : Promise.resolve({ range: query.range })
    )
    const { result, rerender } = renderHook(
      ({ range }: { range: '7d' | '30d' }) => useUsageOverviewQuery(range, true),
      { initialProps: { range: '7d' } }
    )
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3))
    rerender({ range: '30d' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const latest = result.current.data
    await act(async () => {
      release({ range: '7d' })
      await old
    })
    expect(result.current.data).toBe(latest)
  })
})
