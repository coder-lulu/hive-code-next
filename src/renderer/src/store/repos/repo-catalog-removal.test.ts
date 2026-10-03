import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type * as RepoCatalogMerge from './repo-catalog-merge'
import { createTestStore, makeWorktree } from '../slices/store-test-helpers'
import { fetchRepoCatalogForTarget, type FetchedRepoCatalog } from './repo-catalog-merge'
import { resetAuthoritativelyRemovedWorktreeMemoryForTests } from '../slices/worktrees/listing/authoritative-worktree-removal-memory'
import { makeDetectedResult } from '../slices/worktrees-detected-listing-fixtures'
import { mergeFetchedWorktrees } from '../slices/worktrees/listing/fetched-worktree-merge'

vi.mock('./repo-catalog-merge', async (importOriginal) => ({
  ...(await importOriginal<typeof RepoCatalogMerge>()),
  fetchRepoCatalogForTarget: vi.fn()
}))
vi.mock('./safe-auto-fork-sync', () => ({ scheduleSafeAutoForkSync: vi.fn() }))
vi.mock('../slices/worktree-visibility-owner-settings', () => ({
  readRuntimeWorktreeVisibilitySnapshot: vi.fn(async () => ({ defaults: undefined }))
}))

const hostId = 'runtime:catalog-removal'
const repo: Repo = {
  id: 'deleted-repo',
  path: '/remote/project',
  displayName: 'Project',
  badgeColor: '',
  addedAt: 0,
  executionHostId: hostId
}
const worktree = makeWorktree({
  id: 'deleted-repo::/remote/project',
  repoId: repo.id,
  hostId
})
const forget = vi.fn(async () => ({ forgottenWorktreeIds: [worktree.id] }))

function catalog(host: FetchedRepoCatalog['hostId'], repos: Repo[] = []): FetchedRepoCatalog {
  return { hostId: host, repos, projectHostSetupCompatibility: { projects: [], setups: [] } }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAuthoritativelyRemovedWorktreeMemoryForTests()
  vi.stubGlobal('window', {
    api: {
      runtimeEnvironments: { list: vi.fn(async () => [{ id: 'catalog-removal' }]) },
      worktrees: { forgetRemovedForExecutionHost: forget }
    }
  })
  vi.mocked(fetchRepoCatalogForTarget).mockImplementation(async (target) =>
    catalog(target.kind === 'local' ? 'local' : hostId)
  )
})

describe('authoritative repo catalog removal', () => {
  it.each(['focused', 'all', 'reconnect'])(
    'retires deleted remote workspaces during %s refresh',
    async (mode) => {
      const store = createTestStore()
      store.setState({
        repos: [repo],
        worktreesByRepo: { [repo.id]: [worktree] },
        activeWorktreeId: worktree.id,
        activeWorkspaceExecutionHostId: hostId
      })
      if (mode === 'focused') {
        await store.getState().fetchRepos({ runtimeEnvironmentId: 'catalog-removal' })
      } else if (mode === 'all') {
        await store.getState().fetchReposForAllHosts()
      } else {
        await store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
      }
      expect(store.getState().repos).toEqual([])
      expect(store.getState().worktreesByRepo[repo.id]).toBeUndefined()
      expect(store.getState().activeWorktreeId).toBeNull()
      expect(forget).toHaveBeenCalledWith({
        repoId: repo.id,
        executionHostId: hostId,
        worktreeIds: [worktree.id]
      })
    }
  )

  it('cleans existing orphans even after the repo record is already gone', async () => {
    const store = createTestStore()
    store.setState({ repos: [], worktreesByRepo: { [repo.id]: [worktree] } })
    await store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
    expect(store.getState().worktreesByRepo[repo.id]).toBeUndefined()
    expect(forget).toHaveBeenCalledOnce()
  })

  it('preserves another host with the same project and worktree ids', async () => {
    const store = createTestStore()
    const local = { ...repo, executionHostId: 'local' as const }
    const localWorktree = { ...worktree, hostId: 'local' as const }
    store.setState({
      repos: [repo, local],
      worktreesByRepo: { [repo.id]: [worktree, localWorktree] },
      activeWorktreeId: worktree.id,
      activeWorkspaceExecutionHostId: 'local'
    })
    await store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
    expect(store.getState().repos).toEqual([local])
    expect(store.getState().worktreesByRepo[repo.id]).toEqual([localWorktree])
    expect(store.getState().activeWorktreeId).toBe(worktree.id)
  })

  it('keeps cached data when the remote catalog fails', async () => {
    const store = createTestStore()
    store.setState({ repos: [repo], worktreesByRepo: { [repo.id]: [worktree] } })
    vi.mocked(fetchRepoCatalogForTarget).mockRejectedValue(new Error('offline'))
    await store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
    expect(store.getState().repos).toEqual([repo])
    expect(store.getState().worktreesByRepo[repo.id]).toEqual([worktree])
    expect(forget).not.toHaveBeenCalled()
  })

  it('retains orphans whose host cannot be established', async () => {
    const store = createTestStore()
    const unowned = { ...worktree, hostId: undefined }
    store.setState({ repos: [], worktreesByRepo: { [repo.id]: [unowned] } })
    await store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
    expect(store.getState().worktreesByRepo[repo.id]).toEqual([unowned])
    expect(forget).not.toHaveBeenCalled()
  })

  it('does not restore a deleted project from an older catalog response', async () => {
    const store = createTestStore()
    store.setState({ repos: [repo], worktreesByRepo: { [repo.id]: [worktree] } })
    let resolveOld: (value: FetchedRepoCatalog) => void = () => undefined
    const oldCatalog = new Promise<FetchedRepoCatalog>((resolve) => {
      resolveOld = resolve
    })
    vi.mocked(fetchRepoCatalogForTarget).mockReturnValueOnce(oldCatalog)
    const oldRefresh = store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
    await store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
    resolveOld(catalog(hostId, [repo]))
    await oldRefresh
    expect(store.getState().repos).toEqual([])
    expect(store.getState().worktreesByRepo[repo.id]).toBeUndefined()
  })

  it('allows a newly added project to appear after deletion', async () => {
    const store = createTestStore()
    store.setState({ repos: [repo], worktreesByRepo: { [repo.id]: [worktree] } })
    await store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
    vi.mocked(fetchRepoCatalogForTarget).mockResolvedValue(catalog(hostId, [repo]))
    await store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
    expect(store.getState().repos).toEqual([repo])
  })

  it('recognizes a paired host owner even when the execution host is local on that peer', async () => {
    const store = createTestStore()
    store.setState({
      repos: [],
      worktreesByRepo: {
        [repo.id]: [{ ...worktree, hostId: 'local', runtimeOwnerEnvironmentId: 'catalog-removal' }]
      }
    })
    await store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
    expect(store.getState().worktreesByRepo[repo.id]).toBeUndefined()
  })

  it('clears detected-only remnants and rejects a late missing-owner worktree response', async () => {
    const store = createTestStore()
    const detected = makeDetectedResult(repo.id, [worktree])
    store.setState({ repos: [], detectedWorktreesByRepo: { [repo.id]: detected } })
    await store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
    expect(store.getState().detectedWorktreesByRepo[repo.id]).toBeUndefined()
    expect(
      mergeFetchedWorktrees(store.setState, {
        repoId: repo.id,
        hostId,
        ownerWasMissingAtStart: true,
        requestStartedWorktrees: undefined,
        refresh: { status: 'admitted', executionHostId: hostId, result: detected }
      })
    ).toBe('not-current')
    expect(store.getState().worktreesByRepo[repo.id]).toBeUndefined()
  })

  it('reports loading and failure without clearing cached project information', async () => {
    const store = createTestStore()
    store.setState({ repos: [repo], worktreesByRepo: { [repo.id]: [worktree] } })
    let rejectCatalog: (error: Error) => void = () => undefined
    vi.mocked(fetchRepoCatalogForTarget).mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectCatalog = reject
      })
    )
    const refresh = store.getState().fetchRuntimeEnvironmentRepos('catalog-removal')
    expect(store.getState().repoCatalogStatusByHost[hostId]).toBe('loading')
    rejectCatalog(new Error('permission denied'))
    await refresh
    expect(store.getState().repoCatalogStatusByHost[hostId]).toBe('unavailable')
    expect(store.getState().repos).toEqual([repo])
  })
})
