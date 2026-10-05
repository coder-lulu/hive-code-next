// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDelayedStatus } from './use-delayed-status'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('does not flash a workbench operation that finishes within its delay', () => {
  const initialProps: { pending: string | null } = { pending: 'loading' }
  const { result, rerender } = renderHook(
    ({ pending }: { pending: string | null }) => useDelayedStatus('account-1', pending, 200),
    { initialProps }
  )
  act(() => vi.advanceTimersByTime(199))
  rerender({ pending: null })
  act(() => vi.advanceTimersByTime(1_000))
  expect(result.current).toBeNull()
})

it('holds a shown operation for its original minimum visible duration', () => {
  const initialProps: { pending: string | null } = { pending: 'loading' }
  const { result, rerender } = renderHook(
    ({ pending }: { pending: string | null }) => useDelayedStatus('account-1', pending, 200),
    { initialProps }
  )
  act(() => vi.advanceTimersByTime(200))
  expect(result.current).toBe('loading')
  rerender({ pending: null })
  act(() => vi.advanceTimersByTime(399))
  expect(result.current).toBe('loading')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current).toBeNull()
})

it('drops the prior account revision immediately and cancels timers on unmount', () => {
  const { result, rerender, unmount } = renderHook(
    ({ revision }) => useDelayedStatus(String(revision), 'loading', 200),
    { initialProps: { revision: 1 } }
  )
  act(() => vi.advanceTimersByTime(200))
  expect(result.current).toBe('loading')
  rerender({ revision: 2 })
  expect(result.current).toBeNull()
  act(() => vi.advanceTimersByTime(199))
  expect(result.current).toBeNull()
  act(() => vi.advanceTimersByTime(1))
  expect(result.current).toBe('loading')
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
