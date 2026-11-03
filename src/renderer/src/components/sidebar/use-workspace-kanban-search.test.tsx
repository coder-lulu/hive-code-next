// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { WORKTREE_PALETTE_QUERY_MAX_BYTES } from '../../../../shared/palette-match/worktree-palette-query-bounds'
import { useWorkspaceKanbanSearch } from './use-workspace-kanban-search'

const worktrees: Worktree[] = [
  {
    id: 'workspace',
    repoId: 'repo',
    path: '/repo/worktree',
    displayName: 'Search board',
    branch: 'main',
    head: 'abc',
    isBare: false,
    isMainWorktree: false,
    hostId: 'local',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1
  }
]
const repoMap = new Map<string, Repo>()
afterEach(cleanup)
it('filters from its controlled owner and sends clear/edit back to that owner', () => {
  const view = renderHook(() => {
    const [query, onQueryChange] = useState('Search')
    return useWorkspaceKanbanSearch({
      open: true,
      worktrees,
      repoMap,
      searchState: { query, onQueryChange }
    })
  })
  expect(view.result.current.matchingWorktreeIds).toEqual(
    new Set(worktrees.map(getWorktreeHostIdentity))
  )
  act(() => view.result.current.setQuery('not present'))
  expect(view.result.current.query).toBe('not present')
  expect(view.result.current.matchingWorktreeIds).toEqual(new Set())
  act(() => view.result.current.clearQuery())
  expect(view.result.current.query).toBe('')
  expect(view.result.current.matchingWorktreeIds).toBeNull()
})
it('retains the upstream query bound for controlled search', () => {
  const view = renderHook(() =>
    useWorkspaceKanbanSearch({
      open: true,
      worktrees,
      repoMap,
      searchState: {
        query: 'x'.repeat(WORKTREE_PALETTE_QUERY_MAX_BYTES + 1),
        onQueryChange: () => {}
      }
    })
  )
  expect(view.result.current.isQueryTooLarge).toBe(true)
  expect(view.result.current.hasQuery).toBe(false)
})
it('clears an uncontrolled query when the drawer closes', () => {
  const view = renderHook(({ open }) => useWorkspaceKanbanSearch({ open, worktrees, repoMap }), {
    initialProps: { open: true }
  })
  act(() => view.result.current.setQuery('Search'))
  view.rerender({ open: false })
  expect(view.result.current.query).toBe('')
})
