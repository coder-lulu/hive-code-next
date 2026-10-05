// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { makeFolderWorkspace, makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'

const mocks = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: mocks.select }))
import { useWorktreeMetaWorkspace } from './use-worktree-meta-workspace'

type Catalog = Pick<AppState, 'worktreesByRepo' | 'detectedWorktreesByRepo' | 'folderWorkspaces'>
let catalog: Catalog
const WORKSPACE = 'same-workspace'
const row = (repoId: string, hostId: ExecutionHostId, linkedIssue: number): Worktree =>
  makeWorktree({ id: WORKSPACE, repoId, hostId, linkedIssue })

afterEach(cleanup)
beforeEach(() => {
  catalog = { worktreesByRepo: {}, detectedWorktreesByRepo: {}, folderWorkspaces: [] }
  mocks.select.mockImplementation((selector: (state: Catalog) => unknown) => selector(catalog))
})

it('does not seed local metadata from the only row belonging to another host', () => {
  catalog.worktreesByRepo = { 'repo-a': [row('repo-a', 'runtime:host-a', 42)] }
  const { result } = renderHook(() =>
    useWorktreeMetaWorkspace({
      worktreeId: WORKSPACE,
      ownerRepoId: 'repo-a',
      executionHostId: 'local'
    })
  )
  expect(result.current.worktree).toBeUndefined()
  expect(result.current.currentIssue).toBe('')
})

it('uses the requested host when a same-id row makes the unqualified index ambiguous', () => {
  const local = row('repo-local', 'local', 17)
  catalog.worktreesByRepo = {
    'repo-a': [row('repo-a', 'runtime:host-a', 42)],
    'repo-local': [local]
  }
  const { result } = renderHook(() =>
    useWorktreeMetaWorkspace({
      worktreeId: WORKSPACE,
      ownerRepoId: null,
      executionHostId: 'local'
    })
  )
  expect(result.current.worktree).toBe(local)
  expect(result.current.currentIssue).toBe('17')
})

it('retains both physical SSH and logical runtime ownership of a paired row', () => {
  const paired = { ...row('repo-a', 'ssh:paired-host', 42), runtimeOwnerEnvironmentId: 'hub-a' }
  catalog.worktreesByRepo = { 'repo-a': [paired] }
  for (const executionHostId of ['ssh:paired-host', 'runtime:hub-a']) {
    const { result, unmount } = renderHook(() =>
      useWorktreeMetaWorkspace({ worktreeId: WORKSPACE, ownerRepoId: 'repo-a', executionHostId })
    )
    expect(result.current.worktree).toBe(paired)
    unmount()
  }
})

it('fails closed for an invalid explicit host instead of using an unqualified row', () => {
  catalog.worktreesByRepo = { 'repo-local': [row('repo-local', 'local', 17)] }
  const { result } = renderHook(() =>
    useWorktreeMetaWorkspace({
      worktreeId: WORKSPACE,
      ownerRepoId: 'repo-local',
      executionHostId: 'ssh:'
    })
  )
  expect(result.current.worktree).toBeUndefined()
})

it('does not seed a local folder dialog from a remote folder with the same id', () => {
  catalog.folderWorkspaces = [
    makeFolderWorkspace({ id: 'same-folder', executionHostId: 'runtime:host-a' })
  ]
  const { result } = renderHook(() =>
    useWorktreeMetaWorkspace({
      worktreeId: 'folder:same-folder',
      ownerRepoId: null,
      executionHostId: 'local'
    })
  )
  expect(result.current.worktree).toBeUndefined()
  expect(result.current.currentIssue).toBe('')
})
