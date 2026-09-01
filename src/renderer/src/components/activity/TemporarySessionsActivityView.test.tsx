// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { TemporarySessionItem } from '@/hooks/use-temporary-session-collection'

const mocks = vi.hoisted(() => ({
  collection: { items: [] as TemporarySessionItem[], totalCount: 0 },
  deletingSessionKeys: new Set<string>(),
  openSession: vi.fn(),
  requestDelete: vi.fn(),
  virtualKeys: [] as (string | number)[]
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en', resolvedLanguage: 'en' } })
}))

vi.mock('@/components/AgentStateDot', () => ({
  AgentStateDot: ({ title }: { title: string }) => <span aria-label={title} />
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, key: string) => String(values?.[key] ?? ''))
}))

vi.mock('@/i18n/relative-time-format', () => ({
  formatUiRelativeTime: () => 'just now'
}))

vi.mock('@/lib/execution-host-display-label', () => ({
  selectExecutionHostDisplayLabel: (_state: unknown, hostId: string) => `Host ${hostId}`
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector({}),
    { getState: () => ({}) }
  )
}))

vi.mock('@/hooks/use-temporary-session-collection', () => ({
  temporarySessionIdentityKey: (item: TemporarySessionItem) =>
    `${item.ownerBucketKey ?? item.worktreeId ?? 'standalone'}|${item.id}`,
  useTemporarySessionCollection: () => mocks.collection
}))

vi.mock('@/hooks/use-temporary-session-list-actions', () => ({
  useTemporarySessionListActions: () => ({
    deletingSessionKeys: mocks.deletingSessionKeys,
    openSession: mocks.openSession,
    requestDelete: mocks.requestDelete
  })
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    getItemKey
  }: {
    count: number
    getItemKey: (index: number) => string | number
  }) => {
    const start = count > 30 ? 20 : 0
    const end = count === 0 ? -1 : Math.min(count - 1, start + 5)
    mocks.virtualKeys.splice(0)
    return {
      getTotalSize: () => count * 64,
      getVirtualItems: () =>
        Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => {
          const index = start + offset
          const key = getItemKey(index)
          mocks.virtualKeys.push(key)
          return { index, key, start: index * 64 }
        }),
      measureElement: () => {}
    }
  }
}))

import TemporarySessionsActivityView from './TemporarySessionsActivityView'

function makeSession(index: number): TemporarySessionItem {
  return {
    id: `provider-${index}`,
    title: `Session ${index}`,
    worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
    ownerBucketKey:
      index % 2 === 0
        ? FLOATING_TERMINAL_WORKTREE_ID
        : `runtime:remote-${index}|${FLOATING_TERMINAL_WORKTREE_ID}`,
    unifiedTabId: `unified-${index}`,
    terminalTabId: `terminal-${index}`,
    tabId: `unified-${index}`,
    paneKey: `terminal-${index}:1`,
    executionHostId: index % 2 === 0 ? 'local' : `runtime:remote-${index}`,
    status: index % 3 === 0 ? 'running' : 'waiting',
    lastActivityAt: Date.now()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.deletingSessionKeys = new Set()
  const items = Array.from({ length: 500 }, (_, index) => makeSession(index))
  mocks.collection = { items, totalCount: items.length }
})

afterEach(cleanup)

describe('TemporarySessionsActivityView', () => {
  it('shows the true count while mounting only the virtual window', () => {
    render(<TemporarySessionsActivityView />)

    expect(screen.getByTestId('temporary-session-count').textContent).toBe('500')
    expect(screen.getAllByTestId('temporary-session-row')).toHaveLength(6)
    expect(screen.getByText('Session 20')).toBeTruthy()
    expect(screen.queryByText('Session 0')).toBeNull()
    expect(mocks.virtualKeys).toEqual(
      mocks.collection.items.slice(20, 26).map((item) => `${item.ownerBucketKey}|${item.id}`)
    )
  })

  it('filters the complete collection before virtualizing it', () => {
    render(<TemporarySessionsActivityView />)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search temporary sessions' }), {
      target: { value: 'Session 499' }
    })

    expect(screen.getAllByTestId('temporary-session-row')).toHaveLength(1)
    expect(screen.getByText('Session 499')).toBeTruthy()
  })

  it('opens and requests deletion for the selected host-qualified session', () => {
    render(<TemporarySessionsActivityView />)
    const item = mocks.collection.items[21]

    fireEvent.click(screen.getByRole('button', { name: 'Open temporary session Session 21' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete temporary session Session 21' }))

    expect(mocks.openSession).toHaveBeenCalledWith(item)
    expect(mocks.requestDelete).toHaveBeenCalledWith(item)
  })

  it('disables only the row currently being deleted', () => {
    const deletingItem = mocks.collection.items[21]
    mocks.deletingSessionKeys = new Set([`${deletingItem.ownerBucketKey}|${deletingItem.id}`])

    render(<TemporarySessionsActivityView />)

    expect(
      screen
        .getByRole('button', { name: 'Open temporary session Session 21' })
        .hasAttribute('disabled')
    ).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Delete temporary session Session 21' })
        .hasAttribute('disabled')
    ).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Open temporary session Session 20' })
        .hasAttribute('disabled')
    ).toBe(false)
  })

  it('distinguishes an empty collection from an empty search result', () => {
    const { rerender } = render(<TemporarySessionsActivityView />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing session' } })
    expect(screen.getByText('No matching temporary sessions')).toBeTruthy()

    mocks.collection = { items: [], totalCount: 0 }
    rerender(<TemporarySessionsActivityView />)
    expect(screen.getByText('No temporary sessions')).toBeTruthy()
  })
})
