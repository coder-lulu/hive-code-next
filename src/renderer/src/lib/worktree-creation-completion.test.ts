import { beforeEach, expect, it, vi } from 'vitest'
import type { WorktreeCreationRequest } from './pending-worktree-creation'
import { completeWorktreeCreation } from './worktree-creation-completion'

const mocks = vi.hoisted(() => ({
  pending: {} as Record<string, { returnToSessions?: boolean }>,
  navigate: vi.fn(),
  remove: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      pendingWorktreeCreations: mocks.pending,
      removePendingWorktreeCreation: mocks.remove
    })
  }
}))
vi.mock('@/lib/workspace-creation-session-return', () => ({
  returnCreatedWorkspaceToSessions: mocks.navigate
}))
vi.mock('@/lib/worktree-creation-followup-startup', () => ({
  needsPostCreateAgentStartup: () => false
}))
vi.mock('@/lib/new-workspace', () => ({ ensureAgentStartupInTerminal: vi.fn() }))
vi.mock('@/lib/workspace-activation-terminal-focus', () => ({
  queueWorkspaceActivationTerminalFocus: vi.fn()
}))
vi.mock('@/lib/worktree-creation-agent-seeds', () => ({
  seedAgentTabStateAfterWorktreeCreate: vi.fn()
}))

beforeEach(() => {
  mocks.pending = {}
  vi.clearAllMocks()
})
const args = () => ({
  creationId: 'create',
  request: {} as WorktreeCreationRequest,
  worktreeId: 'new-owner',
  structuredLaunchAccepted: true,
  activation: false as const,
  primaryTabId: null,
  backendSpawned: false,
  focusOnCompletion: true
})
it('returns to the created owner only after successful foreground completion', async () => {
  mocks.pending.create = { returnToSessions: true }
  await completeWorktreeCreation(args())
  expect(mocks.navigate).toHaveBeenCalledWith('new-owner')
  expect(mocks.remove).toHaveBeenCalledWith('create', { cleanupVm: false })
})
it('does not redirect a cancelled creation with no pending entry', async () => {
  await completeWorktreeCreation(args())
  expect(mocks.navigate).not.toHaveBeenCalled()
})
it('does not pull the user back after they move to another app page', async () => {
  mocks.pending.create = { returnToSessions: true }
  await completeWorktreeCreation({ ...args(), focusOnCompletion: false })
  expect(mocks.navigate).not.toHaveBeenCalled()
})
it('keeps other creation entry points on their existing surface', async () => {
  mocks.pending.create = {}
  await completeWorktreeCreation(args())
  expect(mocks.navigate).not.toHaveBeenCalled()
})
