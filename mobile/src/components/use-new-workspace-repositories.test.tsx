import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, expect, it, vi } from 'vitest'
const fixtures = vi.hoisted(() => ({ lastRepoId: null as string | null, cached: null as unknown }))
vi.mock('../cache/repo-cache', () => ({
  getCachedRepos: () => fixtures.cached,
  setCachedRepos: () => {}
}))
vi.mock('../worktree/use-last-visited-worktree-repo', () => ({
  useLastVisitedWorktreeRepoId: () => ({ loaded: true, repoId: fixtures.lastRepoId })
}))
import { FakeSession } from '../transport/mobile-endpoint-supervisor-test-fakes'
import { useNewWorkspaceRepositories } from './use-new-workspace-repositories'
const local = { id: 'local-repo', displayName: 'local', path: '/local' }
const retired = {
  id: 'old-repo',
  displayName: 'old',
  path: '/old',
  executionHostId: 'runtime:old' as const
}
beforeEach(() => {
  fixtures.lastRepoId = null
  fixtures.cached = null
})
async function mount() {
  const client = new FakeSession('connected')
  client.sendRequest.mockResolvedValue({ id: '1', ok: true, result: { repos: [local, retired] } })
  let model: ReturnType<typeof useNewWorkspaceRepositories> | undefined
  function Probe() {
    model = useNewWorkspaceRepositories({ client, hostId: 'account-runtime', visible: true })
    return null
  }
  await act(async () => {
    create(createElement(Probe))
  })
  return () => model!
}
it('defaults to a valid local repo without offering a delegated target', async () => {
  const model = await mount()
  expect(model().repos).toEqual([local])
  expect(model().selectedRepo).toEqual(local)
})
it('keeps a cached retired selection unavailable instead of silently choosing local', async () => {
  fixtures.lastRepoId = retired.id
  fixtures.cached = [local, retired]
  const model = await mount()
  expect(model().selectedRepo).toBeNull()
  expect(model()).toHaveProperty('selectionError', expect.stringContaining('Runtime'))
  await act(async () => model().setSelectedRepo(local))
  expect(model().selectedRepo).toEqual(local)
  expect(model()).toHaveProperty('selectionError', '')
})
it('rejects an explicit stale selection without defaulting to another execution host', async () => {
  const model = await mount()
  await act(async () => model().setSelectedRepo(retired))
  expect(model().selectedRepo).toBeNull()
  expect(model()).toHaveProperty('selectionError', expect.stringContaining('Runtime'))
})
