import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ worktree: vi.fn(), folder: vi.fn() }))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.worktree,
  activateAndRevealFolderWorkspace: mocks.folder
}))
import { activateWorktreeFromSidebar } from './sidebar-worktree-activation'
afterEach(() => vi.clearAllMocks())
it('notifies only after a successful worktree activation', async () => {
  const notify = vi.fn()
  mocks.worktree.mockReturnValue(false)
  await activateWorktreeFromSidebar('main', 'local', notify)
  expect(notify).not.toHaveBeenCalled()
  mocks.worktree.mockReturnValue({ primaryTabId: null })
  await activateWorktreeFromSidebar('main', 'local', notify)
  expect(notify).toHaveBeenCalledOnce()
})
it('keeps a refused folder activation open and notifies on success', async () => {
  const notify = vi.fn()
  mocks.folder.mockReturnValue(false)
  await activateWorktreeFromSidebar('folder:notes', 'local', notify)
  expect(notify).not.toHaveBeenCalled()
  mocks.folder.mockReturnValue({ primaryTabId: null })
  await activateWorktreeFromSidebar('folder:notes', 'local', notify)
  expect(notify).toHaveBeenCalledOnce()
})
