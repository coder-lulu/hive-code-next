// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { useCompleteGitRepoAdd } from './use-complete-git-repo-add'

vi.mock('@/lib/telemetry', () => ({ track: vi.fn() }))

const initialState = useAppStore.getInitialState()

describe('useCompleteGitRepoAdd space routing', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
    useAppStore.setState({ worktreesByRepo: { 'repo-1': [] } })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('associates a scoped project before completing the add flow', async () => {
    const moveProjectToGroup = vi.fn().mockResolvedValue(true)
    const finishProjectAdd = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ moveProjectToGroup })
    const { result } = renderHook(() =>
      useCompleteGitRepoAdd({
        closeModal: vi.fn(),
        setHideDefaultBranchWorkspace: vi.fn(),
        finishProjectAdd,
        projectGroupId: 'space-1'
      })
    )

    await act(async () => {
      await result.current('repo-1', 'local_folder_picker', 'local')
    })

    expect(moveProjectToGroup).toHaveBeenCalledWith('repo-1', 'space-1')
    expect(finishProjectAdd).toHaveBeenCalledWith('repo-1', 'local_folder_picker', 'local')
    expect(moveProjectToGroup.mock.invocationCallOrder[0]).toBeLessThan(
      finishProjectAdd.mock.invocationCallOrder[0]
    )
  })

  it('keeps an explicit Ungrouped target distinct from a global add', async () => {
    const moveProjectToGroup = vi.fn().mockResolvedValue(true)
    const finishProjectAdd = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ moveProjectToGroup })
    const scoped = renderHook(() =>
      useCompleteGitRepoAdd({
        closeModal: vi.fn(),
        setHideDefaultBranchWorkspace: vi.fn(),
        finishProjectAdd,
        projectGroupId: null
      })
    )

    await act(async () => {
      await scoped.result.current('repo-1', 'local_folder_picker')
    })
    expect(moveProjectToGroup).toHaveBeenCalledWith('repo-1', null)

    moveProjectToGroup.mockClear()
    const global = renderHook(() =>
      useCompleteGitRepoAdd({
        closeModal: vi.fn(),
        setHideDefaultBranchWorkspace: vi.fn(),
        finishProjectAdd
      })
    )
    await act(async () => {
      await global.result.current('repo-1', 'local_folder_picker')
    })
    expect(moveProjectToGroup).not.toHaveBeenCalled()
  })
})
