import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { resolveHiveAgentLocalProject } from './hive-agent-local-project'
import type { RuntimeFileCommandHost } from '../runtime/runtime-file-command-host'
import type { Repo } from '../../shared/repo-types'
import { inferFolderWorkspacePathConnection } from '../project-groups/folder-workspace-path-status'

const routing = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('../local-project-runtime-resolution', () => ({
  resolveLocalProjectRuntimeForRepo: routing.resolve
}))
let root: string
const base = resolve('logs/ai-local-project-tests')
beforeAll(async () => {
  await mkdir(base, { recursive: true })
  root = await mkdtemp(join(base, 'project 中文 '))
})
afterAll(async () => {
  if (root && root.startsWith(base)) {
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture(folder = true) {
  const path = await mkdtemp(join(root, 'workspace '))
  const record = {
    id: 'folder-1',
    projectGroupId: 'group',
    folderPath: path,
    createdAt: 1,
    isArchived: false,
    name: 'old label'
  }
  let repo: Repo = {
    id: 'repo-1',
    path,
    displayName: 'repo',
    badgeColor: '',
    addedAt: 1,
    executionHostId: 'local'
  }
  let available = true
  const runtime = {
    resolveRuntimeFileTarget: vi
      .fn<RuntimeFileCommandHost['resolveRuntimeFileTarget']>()
      .mockResolvedValue({
        executionHostId: 'local',
        worktree: { id: folder ? 'folder:folder-1' : 'repo-1::worktree', repoId: 'repo-1', path }
      } as never)
  }
  const store: Parameters<typeof resolveHiveAgentLocalProject>[1] = {
    getRepos: () => (available ? [repo] : []),
    getProjectGroups: () => [],
    getFolderWorkspaces: () => (available ? ([record] as never) : []),
    getProjects: () => [],
    getSettings: () => ({}) as never,
    getWorktreeMetaForHost: () => undefined
  }
  routing.resolve.mockReturnValue({
    status: 'resolved',
    runtime: { kind: 'windows-host', cacheKey: 'native-project' }
  })
  return {
    path,
    record,
    runtime,
    store,
    remove: () => {
      available = false
    },
    reroute: () => {
      repo = { ...repo, executionHostId: 'ssh:other' }
    }
  }
}
it.each([true, false])(
  'binds a resolved local %s project through the existing resolver',
  async (folder) => {
    const f = await fixture(folder)
    const project = await resolveHiveAgentLocalProject(f.runtime, f.store, 'selected-workspace')
    expect(f.runtime.resolveRuntimeFileTarget).toHaveBeenCalledWith('selected-workspace')
    expect(project.workspaceKind).toBe(folder ? 'folder' : 'git-worktree')
    expect(() => project.assertCurrent()).not.toThrow()
    f.remove()
    expect(() => project.assertCurrent()).toThrow('hive_agent_forbidden')
  }
)
it.each(['ssh:offline', 'runtime:another-host'])(
  'refuses %s before reading its path locally',
  async (executionHostId) => {
    const f = await fixture()
    f.runtime.resolveRuntimeFileTarget.mockResolvedValueOnce({
      executionHostId,
      worktree: { path: 'unreachable-path' }
    } as never)
    await expect(
      resolveHiveAgentLocalProject(f.runtime, f.store, 'remote-project')
    ).rejects.toThrow('hive_agent_forbidden')
  }
)
it('refuses WSL paths and unresolved or WSL project routing without native fallback', async () => {
  const f = await fixture(false)
  f.runtime.resolveRuntimeFileTarget.mockResolvedValueOnce({
    executionHostId: 'local',
    worktree: { path: '\\\\wsl.localhost\\Ubuntu\\srv\\project' }
  } as never)
  await expect(resolveHiveAgentLocalProject(f.runtime, f.store, 'wsl-project')).rejects.toThrow(
    'hive_agent_forbidden'
  )
  routing.resolve.mockReturnValueOnce({
    status: 'repair-required',
    repair: { reason: 'wsl-unavailable' }
  })
  await expect(resolveHiveAgentLocalProject(f.runtime, f.store, 'repair-project')).rejects.toThrow(
    'hive_agent_forbidden'
  )
  routing.resolve.mockReturnValueOnce({
    status: 'resolved',
    runtime: { kind: 'wsl', cacheKey: 'wsl-project' }
  })
  await expect(resolveHiveAgentLocalProject(f.runtime, f.store, 'wsl-project')).rejects.toThrow(
    'hive_agent_forbidden'
  )
})
it('keeps a renamed folder valid but invalidates archive and replacement of its physical root', async () => {
  const f = await fixture()
  const project = await resolveHiveAgentLocalProject(f.runtime, f.store, 'folder-project')
  f.record.name = 'first message label'
  expect(() => project.assertCurrent()).not.toThrow()
  f.record.isArchived = true
  expect(() => project.assertCurrent()).toThrow('hive_agent_forbidden')
  f.record.isArchived = false
  await rename(f.path, join(root, 'original-workspace'))
  await mkdir(f.path)
  expect(() => project.assertCurrent()).toThrow('hive_agent_forbidden')
})
it('invalidates a native Git binding when its repository moves to another execution host', async () => {
  const f = await fixture(false)
  const project = await resolveHiveAgentLocalProject(f.runtime, f.store, 'git-project')
  f.reroute()
  expect(() => project.assertCurrent()).toThrow('hive_agent_forbidden')
})
it('selects the explicit local repo even when an identically named SSH repo comes first', async () => {
  const f = await fixture(false)
  const local = f.store.getRepos()[0]
  f.store.getRepos = () => [{ ...local, executionHostId: 'ssh:other' }, local]
  const target = await f.runtime.resolveRuntimeFileTarget('local-project')
  f.runtime.resolveRuntimeFileTarget.mockResolvedValue({
    ...target,
    worktree: { ...target.worktree, hostId: 'local' }
  })
  const project = await resolveHiveAgentLocalProject(f.runtime, f.store, 'local-project')
  expect(() => project.assertCurrent()).not.toThrow()
  expect(routing.resolve).toHaveBeenLastCalledWith(f.store, local)
})
it('refuses unowned or ambiguous git routing even if the file resolver labels the path local', async () => {
  const f = await fixture(false)
  const local = f.store.getRepos()[0]
  f.store.getRepos = () => [{ ...local, executionHostId: 'ssh:other' }, local]
  await expect(
    resolveHiveAgentLocalProject(f.runtime, f.store, 'ambiguous-project')
  ).rejects.toThrow('hive_agent_forbidden')
  f.store.getRepos = () => []
  await expect(resolveHiveAgentLocalProject(f.runtime, f.store, 'unowned-project')).rejects.toThrow(
    'hive_agent_forbidden'
  )
})
it.each(['group', 'inherited', 'ambiguous'] as const)(
  'invalidates a folder binding after its %s connection changes',
  async (mode) => {
    const f = await fixture()
    const project = await resolveHiveAgentLocalProject(f.runtime, f.store, 'folder-project')
    const local = f.store.getRepos()[0]
    if (mode === 'group') {
      f.store.getProjectGroups = () => [{ id: 'group', connectionId: 'other' }] as never
      f.store.getRepos = () => []
    } else {
      const remote = { ...local, id: 'remote', connectionId: 'other', projectGroupId: 'group' }
      f.store.getRepos = () => (mode === 'ambiguous' ? [local, remote] : [remote])
    }
    const groups = f.store.getProjectGroups()
    const connection = inferFolderWorkspacePathConnection({
      folderPath: f.record.folderPath,
      projectGroupId: f.record.projectGroupId,
      connectionId: groups.find((group) => group.id === f.record.projectGroupId)?.connectionId,
      projectGroups: groups,
      repos: f.store.getRepos()
    })
    expect(connection.kind).not.toBe('local')
    expect(() => project.assertCurrent()).toThrow('hive_agent_forbidden')
    await expect(
      resolveHiveAgentLocalProject(f.runtime, f.store, 'folder-project')
    ).rejects.toThrow('hive_agent_forbidden')
  }
)

it('uses the fixed local temporary-session scope without inventing a repository', async () => {
  const f = await fixture()
  const project = await resolveHiveAgentLocalProject(f.runtime, f.store, 'global-floating-terminal')
  expect(project.projectScope).toBe('global-floating-terminal')
  expect(project.workspaceKind).toBe('folder')
  expect(() => project.assertCurrent()).not.toThrow()
  expect(f.runtime.resolveRuntimeFileTarget).not.toHaveBeenCalled()
})
