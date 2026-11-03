import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activateAndRevealFolderWorkspace: vi.fn(),
  activateAndRevealWorktree: vi.fn()
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealFolderWorkspace: mocks.activateAndRevealFolderWorkspace,
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))

import { activateWorktreeFromSidebar } from './sidebar-worktree-activation'

describe('sidebar worktree activation', () => {
  beforeEach(() => {
    mocks.activateAndRevealWorktree.mockClear()
    mocks.activateAndRevealFolderWorkspace.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('switches immediately while an ephemeral runtime wake is pending', async () => {
    let resolveResume: ((value: null) => void) | undefined
    const resumeWorkspace = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveResume = resolve
        })
    )
    vi.stubGlobal('window', {
      api: { ephemeralVm: { resumeWorkspace } }
    })

    const activation = activateWorktreeFromSidebar('wt-vm')

    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith('wt-vm', {
      navigationIntent: 'user-open',
      revealInSidebar: false
    })
    expect(resumeWorkspace).toHaveBeenCalledWith({ workspaceId: 'wt-vm' })

    resolveResume?.(null)
    await activation
  })
})

it('preserves an explicit worktree owner across refused and successful activation', async () => {
  vi.clearAllMocks()
  mocks.activateAndRevealWorktree.mockReturnValue(false)
  await activateWorktreeFromSidebar('main', 'local')
  expect(mocks.activateAndRevealWorktree).toHaveBeenLastCalledWith('main', {
    navigationIntent: 'user-open',
    revealInSidebar: false,
    executionHostId: 'local'
  })
  mocks.activateAndRevealWorktree.mockReturnValue({ primaryTabId: null })
  await activateWorktreeFromSidebar('main', 'local')
  expect(mocks.activateAndRevealWorktree).toHaveBeenCalledTimes(2)
})
it('preserves an explicit folder owner across refused and successful activation', async () => {
  mocks.activateAndRevealFolderWorkspace.mockReturnValue(false)
  await activateWorktreeFromSidebar('folder:notes', 'local')
  expect(mocks.activateAndRevealFolderWorkspace).toHaveBeenLastCalledWith('notes', {
    navigationIntent: 'user-open',
    executionHostId: 'local'
  })
  mocks.activateAndRevealFolderWorkspace.mockReturnValue({ primaryTabId: null })
  await activateWorktreeFromSidebar('folder:notes', 'local')
  expect(mocks.activateAndRevealFolderWorkspace).toHaveBeenCalledTimes(2)
})
