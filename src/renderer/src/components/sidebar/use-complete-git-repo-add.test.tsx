// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { useCompleteGitRepoAdd } from './use-complete-git-repo-add'

vi.mock('@/lib/telemetry', () => ({ track: vi.fn() }))

const initialState = useAppStore.getInitialState()

vi.mock('./project-added-default-checkout', () => ({
  finishProjectAddWithDefaultCheckout: vi.fn().mockResolvedValue(undefined)
}))

const { finishProjectAddWithDefaultCheckout } = await import('./project-added-default-checkout')

describe('useCompleteGitRepoAdd completion ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState(initialState, true)
    useAppStore.setState({ worktreesByRepo: { 'repo-1': [] } })
  })
  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('forwards the originating host and imported group outcome to the hosted composer', async () => {
    const closeModal = vi.fn()
    const moveProjectToGroup = vi.fn().mockResolvedValue(true)
    const finishProjectAdd = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ moveProjectToGroup })
    const { result } = renderHook(() =>
      useCompleteGitRepoAdd({
        closeModal,
        setHideDefaultBranchWorkspace: vi.fn(),
        finishProjectAdd
      })
    )
    const outcome = { importedProjectGroupId: 'space-1' }
    await act(async () => {
      await result.current('repo-1', 'local_folder_picker', 'runtime:remote', outcome)
    })
    expect(finishProjectAdd).toHaveBeenCalledWith(
      'repo-1',
      'local_folder_picker',
      'runtime:remote',
      outcome
    )
    expect(moveProjectToGroup).not.toHaveBeenCalled()
    expect(closeModal).not.toHaveBeenCalled()
    expect(finishProjectAddWithDefaultCheckout).not.toHaveBeenCalled()
  })

  it('delegates standalone completion to the default checkout owner with the originating host', async () => {
    const closeModal = vi.fn()
    const setHideDefaultBranchWorkspace = vi.fn()
    const { result } = renderHook(() =>
      useCompleteGitRepoAdd({ closeModal, setHideDefaultBranchWorkspace })
    )
    await act(async () => {
      await result.current('repo-1', 'local_folder_picker', 'local')
    })
    expect(finishProjectAddWithDefaultCheckout).toHaveBeenCalledExactlyOnceWith({
      repoId: 'repo-1',
      source: 'local_folder_picker',
      executionHostId: 'local',
      closeModal,
      setHideDefaultBranchWorkspace
    })
  })
})
