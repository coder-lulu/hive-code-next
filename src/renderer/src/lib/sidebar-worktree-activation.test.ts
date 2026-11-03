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

it('notifies only after a successful worktree activation', async () => {
  const notify = vi.fn()
  mocks.activateAndRevealWorktree.mockReturnValue(false)
  await activateWorktreeFromSidebar('main', 'local', notify)
  expect(notify).not.toHaveBeenCalled()
  mocks.activateAndRevealWorktree.mockReturnValue({ primaryTabId: null })
  await activateWorktreeFromSidebar('main', 'local', notify)
  expect(notify).toHaveBeenCalledOnce()
})
it('keeps a refused folder activation open and notifies on success', async () => {
  const notify = vi.fn()
  mocks.activateAndRevealFolderWorkspace.mockReturnValue(false)
  await activateWorktreeFromSidebar('folder:notes', 'local', notify)
  expect(notify).not.toHaveBeenCalled()
  mocks.activateAndRevealFolderWorkspace.mockReturnValue({ primaryTabId: null })
  await activateWorktreeFromSidebar('folder:notes', 'local', notify)
  expect(notify).toHaveBeenCalledOnce()
})
