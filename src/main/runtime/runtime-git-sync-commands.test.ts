import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'
import type { GitPushTarget } from '../../shared/worktree/types'
import type * as GitRemoteModule from '../git/remote'
import type * as GitStatusModule from '../git/status'
import type * as GitForkSyncModule from '../git/fork-sync'
import type { RuntimeGitTarget, ResolvedRuntimeGitWorktree } from './runtime-git-command-target'
import { RuntimeGitSyncCommands } from './runtime-git-sync-commands'
import { ExecutionHostNotDispatchableError } from '../providers/execution-host-provider-dispatch'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'

const mocks = vi.hoisted(() => ({
  abortMerge: vi.fn(),
  abortRebase: vi.fn(),
  commitChanges: vi.fn(),
  completeMerge: vi.fn(),
  gitSyncForkDefaultBranch: vi.fn(),
  gitFastForward: vi.fn(),
  gitFetch: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  materializePushTarget: vi.fn()
}))

vi.mock('../ipc/worktree-remote', () => ({
  materializeWorktreePushTargetRemote: mocks.materializePushTarget
}))

vi.mock('../git/fork-sync', async () => ({
  ...(await vi.importActual<typeof GitForkSyncModule>('../git/fork-sync')),
  gitSyncForkDefaultBranch: mocks.gitSyncForkDefaultBranch
}))

vi.mock('../git/status', async () => ({
  ...(await vi.importActual<typeof GitStatusModule>('../git/status')),
  abortMerge: mocks.abortMerge,
  abortRebase: mocks.abortRebase,
  commitChanges: mocks.commitChanges,
  completeMerge: mocks.completeMerge
}))

vi.mock('../git/remote', async () => ({
  ...(await vi.importActual<typeof GitRemoteModule>('../git/remote')),
  gitFastForward: mocks.gitFastForward,
  gitFetch: mocks.gitFetch,
  gitPull: mocks.gitPull,
  gitPush: mocks.gitPush
}))

const worktree: ResolvedRuntimeGitWorktree = {
  id: 'wt-1',
  hostId: 'local',
  repoId: 'repo-1',
  path: '/workspace/repo',
  displayName: 'repo',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0,
  head: 'abc',
  branch: 'main',
  isBare: false,
  isMainWorktree: false,
  git: {
    path: '/workspace/repo',
    head: 'abc',
    branch: 'main',
    isBare: false,
    isMainWorktree: false
  }
}
const pushTarget = {
  remoteName: 'origin',
  branchName: 'main'
} satisfies GitPushTarget
const expectedUpstream = { owner: 'stablyai', repo: 'orca' }

describe('RuntimeGitSyncCommands admission', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.materializePushTarget.mockImplementation(async (_path, target) => target)
  })

  it('prioritizes local runtime git actions and preserves host routing', async () => {
    const commands = new RuntimeGitSyncCommands({
      resolveRuntimeGitTarget: async () => ({
        executionHostId: 'local',
        worktree,
        localGitOptions: { wslDistro: 'Ubuntu' }
      }),
      getRuntimeSettings: () => createGlobalSettingsFixture()
    })
    mocks.commitChanges.mockResolvedValue({ success: true })
    mocks.completeMerge.mockResolvedValue({ success: true })
    mocks.gitSyncForkDefaultBranch.mockResolvedValue({ status: 'up-to-date' })

    await commands.abortRuntimeGitMerge('id:wt-1')
    await expect(commands.completeRuntimeGitMerge('id:wt-1')).resolves.toEqual({ success: true })
    await commands.abortRuntimeGitRebase('id:wt-1')
    await commands.fetchRuntimeGit('id:wt-1', pushTarget)
    await commands.syncRuntimeGitForkDefaultBranch('id:wt-1', expectedUpstream)
    await commands.pullRuntimeGit('id:wt-1', pushTarget)
    await commands.fastForwardRuntimeGit('id:wt-1', pushTarget)
    await commands.commitRuntimeGit('id:wt-1', 'feat: prioritize user action')

    const options = { admissionTier: 'interactive', wslDistro: 'Ubuntu' }
    expect(mocks.abortMerge).toHaveBeenCalledWith(worktree.path, options)
    expect(mocks.completeMerge).toHaveBeenCalledWith(worktree.path, options)
    expect(mocks.abortRebase).toHaveBeenCalledWith(worktree.path, options)
    expect(mocks.gitFetch).toHaveBeenCalledWith(worktree.path, pushTarget, options)
    expect(mocks.gitSyncForkDefaultBranch).toHaveBeenCalledWith(
      worktree.path,
      expectedUpstream,
      options
    )
    expect(mocks.gitPull).toHaveBeenCalledWith(worktree.path, pushTarget, options)
    expect(mocks.gitFastForward).toHaveBeenCalledWith(worktree.path, pushTarget, options)
    expect(mocks.commitChanges).toHaveBeenCalledWith(
      worktree.path,
      'feat: prioritize user action',
      options
    )
  })

  it('refuses every runtime git action on an SSH host without running git here', async () => {
    const commands = new RuntimeGitSyncCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree,
        executionHostId: 'ssh:conn-1'
      }),
      getRuntimeSettings: () => createGlobalSettingsFixture()
    })

    await expect(commands.abortRuntimeGitMerge('id:wt-1')).rejects.toThrow(SshHostNotServedError)
    await expect(commands.completeRuntimeGitMerge('id:wt-1')).rejects.toThrow(SshHostNotServedError)
    await expect(commands.fetchRuntimeGit('id:wt-1', pushTarget)).rejects.toThrow(
      SshHostNotServedError
    )
    await expect(commands.pullRuntimeGit('id:wt-1', pushTarget)).rejects.toThrow(
      SshHostNotServedError
    )
    await expect(commands.commitRuntimeGit('id:wt-1', 'feat: remote')).rejects.toThrow(
      SshHostNotServedError
    )
    expect(mocks.abortMerge).not.toHaveBeenCalled()
    expect(mocks.completeMerge).not.toHaveBeenCalled()
    expect(mocks.gitFetch).not.toHaveBeenCalled()
    expect(mocks.gitPull).not.toHaveBeenCalled()
    expect(mocks.commitChanges).not.toHaveBeenCalled()
  })
  it.each(['fetch', 'pull', 'fastForward', 'push'] as const)(
    'persists the resolved host-qualified target after %s remote materialization',
    async (action) => {
      const materialized = { ...pushTarget, remoteCreated: true }
      mocks.materializePushTarget.mockResolvedValue(materialized)
      const persist = vi.fn()
      const commands = new RuntimeGitSyncCommands({
        resolveRuntimeGitTarget: async () => ({
          executionHostId: 'local',
          worktree,
          localGitOptions: { wslDistro: 'Ubuntu' }
        }),
        getRuntimeSettings: () => createGlobalSettingsFixture(),
        captureMaterializedPushTargetPersistence: () => persist
      })
      if (action === 'push') {
        await commands.pushRuntimeGit('id:wt-1', false, pushTarget)
      } else if (action === 'fetch') {
        await commands.fetchRuntimeGit('id:wt-1', pushTarget)
      } else if (action === 'pull') {
        await commands.pullRuntimeGit('id:wt-1', pushTarget)
      } else {
        await commands.fastForwardRuntimeGit('id:wt-1', pushTarget)
      }
      expect(persist).toHaveBeenCalledExactlyOnceWith(materialized)
      expect(mocks.materializePushTarget).toHaveBeenCalledWith(
        worktree.path,
        pushTarget,
        undefined,
        undefined,
        { wslDistro: 'Ubuntu' }
      )
    }
  )

  it('retains the resolved host identity while materialization awaits and the selected row changes', async () => {
    let finish!: (value: GitPushTarget) => void
    mocks.materializePushTarget.mockReturnValue(
      new Promise<GitPushTarget>((resolve) => {
        finish = resolve
      })
    )
    const resolved = { ...worktree, instanceId: 'initial-instance' }
    let selected: RuntimeGitTarget = { executionHostId: 'local', worktree: resolved }
    const persist = vi.fn()
    const capture = vi.fn((_target: RuntimeGitTarget) => persist)
    const commands = new RuntimeGitSyncCommands({
      resolveRuntimeGitTarget: async () => selected,
      getRuntimeSettings: () => createGlobalSettingsFixture(),
      captureMaterializedPushTargetPersistence: capture
    })
    const pending = commands.fetchRuntimeGit('id:wt-1', pushTarget)
    await vi.waitFor(() => expect(mocks.materializePushTarget).toHaveBeenCalledTimes(1))
    expect(persist).not.toHaveBeenCalled()
    selected = { executionHostId: 'ssh:other', worktree: { ...resolved, hostId: 'ssh:other' } }
    resolved.hostId = 'ssh:other'
    resolved.instanceId = 'replacement'
    expect(capture).toHaveBeenCalledOnce()
    expect(capture.mock.calls[0][0].worktree).toMatchObject({
      id: 'wt-1',
      hostId: 'local',
      instanceId: 'initial-instance'
    })
    const materialized = { ...pushTarget, remoteCreated: true }
    finish(materialized)
    await pending
    expect(persist).toHaveBeenCalledExactlyOnceWith(materialized)
    expect(mocks.gitFetch).toHaveBeenCalledWith(worktree.path, materialized, {
      admissionTier: 'interactive'
    })
  })

  it('does not invent local metadata ownership when the resolved worktree has no host', async () => {
    const resolved = { ...worktree }
    delete resolved.hostId
    const persist = vi.fn()
    const capture = vi.fn((_target: RuntimeGitTarget) => persist)
    mocks.materializePushTarget.mockResolvedValue({ ...pushTarget, remoteCreated: true })
    const commands = new RuntimeGitSyncCommands({
      resolveRuntimeGitTarget: async () => ({ executionHostId: 'local', worktree: resolved }),
      getRuntimeSettings: () => createGlobalSettingsFixture(),
      captureMaterializedPushTargetPersistence: capture
    })
    await commands.fetchRuntimeGit('id:wt-1', pushTarget)
    expect(capture.mock.calls[0][0].worktree.hostId).toBeUndefined()
    expect(persist).toHaveBeenCalledWith({ ...pushTarget, remoteCreated: true })
  })

  it('does not persist an existing remote or a failed materialization', async () => {
    const persist = vi.fn()
    const commands = new RuntimeGitSyncCommands({
      resolveRuntimeGitTarget: async () => ({ executionHostId: 'local', worktree }),
      getRuntimeSettings: () => createGlobalSettingsFixture(),
      captureMaterializedPushTargetPersistence: () => persist
    })
    await commands.fetchRuntimeGit('id:wt-1', pushTarget)
    expect(persist).not.toHaveBeenCalled()
    mocks.gitFetch.mockClear()
    mocks.materializePushTarget.mockRejectedValue(new Error('remote creation failed'))
    await expect(commands.fetchRuntimeGit('id:wt-1', pushTarget)).rejects.toThrow(
      'remote creation failed'
    )
    expect(persist).not.toHaveBeenCalled()
    expect(mocks.gitFetch).not.toHaveBeenCalled()
  })

  it.each(['ssh:remote', 'runtime:remote'] as const)(
    'refuses sync and persistence for %s before materialization',
    async (hostId) => {
      const persist = vi.fn()
      const commands = new RuntimeGitSyncCommands({
        resolveRuntimeGitTarget: async () => ({
          executionHostId: hostId,
          worktree: { ...worktree, hostId },
          localGitOptions: { wslDistro: 'Ubuntu' }
        }),
        getRuntimeSettings: () => createGlobalSettingsFixture(),
        captureMaterializedPushTargetPersistence: () => persist
      })
      const error =
        hostId === 'ssh:remote' ? SshHostNotServedError : ExecutionHostNotDispatchableError
      await expect(commands.fetchRuntimeGit('id:wt-1', pushTarget)).rejects.toThrow(error)
      await expect(commands.pullRuntimeGit('id:wt-1', pushTarget)).rejects.toThrow(error)
      await expect(commands.fastForwardRuntimeGit('id:wt-1', pushTarget)).rejects.toThrow(error)
      await expect(commands.pushRuntimeGit('id:wt-1', true, pushTarget)).rejects.toThrow(error)
      expect(mocks.materializePushTarget).not.toHaveBeenCalled()
      expect(persist).not.toHaveBeenCalled()
      expect(mocks.gitFetch).not.toHaveBeenCalled()
      expect(mocks.gitPull).not.toHaveBeenCalled()
      expect(mocks.gitFastForward).not.toHaveBeenCalled()
      expect(mocks.gitPush).not.toHaveBeenCalled()
    }
  )
})
