// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { resolveInitialWorkspaceRunSeed } from '../useComposerState'
import { useComposerInitialTargetState } from './initial-target-state'

afterEach(cleanup)

function repo(id: string, connectionId?: string): Repo {
  return { id, connectionId, path: `/repos/${id}`, displayName: id, badgeColor: '', addedAt: 1 }
}

function input(): Parameters<typeof useComposerInitialTargetState>[0] {
  return {
    actionableHostIds: new Set(['local', 'ssh:alpha']),
    decisions: {
      resolveInitialWorkspaceRunSeed,
      canResolveFolderSmartGitHubSubmit: vi.fn(),
      getInitialAutoManagedWorkspaceName: vi.fn(),
      getInitialGitHubPrStartPointSelection: vi.fn(),
      getMatchingLinkedTaskSourceContext: vi.fn(),
      isExplicitWorkspaceNameInput: vi.fn(),
      resolveSmartGitHubCreateNames: vi.fn(),
      retargetGitHubPrStartPointSelection: vi.fn()
    },
    eligibleRepos: [repo('other', 'alpha'), repo('chosen'), repo('chosen', 'alpha')],
    initialRepoId: 'chosen',
    initialExecutionHostId: 'ssh:alpha',
    initialProjectGroupId: undefined,
    initialTaskSourceContext: null,
    initialWorkspaceStatus: undefined,
    newWorkspaceDraft: null,
    persistDraft: false,
    projectGroups: [],
    projectHostSetups: [],
    projects: [],
    repoIdOverride: undefined,
    seedActiveRepoId: 'other',
    workspaceHostScope: 'local',
    workspaceStatuses: []
  }
}

it('seeds the exact repo on its requested host even when another project is first on that host', () => {
  const { result } = renderHook(() => useComposerInitialTargetState(input()))
  expect(result.current.initialRunSeed.hostId).toBe('ssh:alpha')
  expect(result.current.resolvedInitialWorkspaceTarget).toMatchObject({
    status: 'ready',
    target: { repoId: 'chosen', hostId: 'ssh:alpha' }
  })
  expect(result.current.repoId).toBe('chosen')
})

it('does not fall back to another repo or local host when the requested repo is unavailable there', () => {
  const options = input()
  options.eligibleRepos = [repo('other', 'alpha'), repo('chosen')]
  const { result } = renderHook(() => useComposerInitialTargetState(options))
  expect(result.current.resolvedInitialWorkspaceTarget.status).toBe('unavailable')
  expect(result.current.repoId).toBe('')
})

it('retains normal repo seeding when no explicit host was supplied', () => {
  const options = input()
  options.initialExecutionHostId = undefined
  const { result } = renderHook(() => useComposerInitialTargetState(options))
  expect(result.current.resolvedInitialWorkspaceTarget).toMatchObject({
    status: 'ready',
    target: { repoId: 'chosen', hostId: 'local' }
  })
})

it('keeps the project while an explicit host replaces a task source setup on another host', () => {
  const options = input()
  options.initialTaskSourceContext = {
    kind: 'task-source',
    provider: 'github',
    projectId: 'repo:chosen',
    hostId: 'local',
    projectHostSetupId: 'chosen',
    repoId: 'chosen'
  }
  const { result } = renderHook(() => useComposerInitialTargetState(options))
  expect(result.current.resolvedInitialWorkspaceTarget).toMatchObject({
    status: 'ready',
    target: { projectId: 'repo:chosen', repoId: 'chosen', hostId: 'ssh:alpha' }
  })
})
