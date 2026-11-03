import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GitRemoteModule from '../git/remote'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { GitPushTarget } from '../../shared/worktree/types'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
}))
const mocks = vi.hoisted(() => ({ materialize: vi.fn(), fetch: vi.fn(), blocked: vi.fn() }))
vi.mock('../ipc/worktree-remote', () => ({
  materializeWorktreePushTargetRemote: mocks.materialize
}))
vi.mock('../persistence/moving-wsl-projects/wsl-move-background-backoff', () => ({
  isWslMoveWorktreeBlocked: mocks.blocked
}))
vi.mock('../git/remote', async (original) => ({
  ...(await original<typeof GitRemoteModule>()),
  gitFetch: mocks.fetch
}))
import { OrcaRuntimeService } from './orca-runtime'

const id = 'repo::/workspace'
const pushTarget: GitPushTarget = { remoteName: 'fork', branchName: 'main', remoteCreated: true }

function fixture() {
  const row = {
    id,
    repoId: 'repo',
    hostId: 'local',
    instanceId: 'instance-1',
    path: '/workspace',
    git: { path: '/workspace', branch: 'main', head: 'abc', isBare: false, isMainWorktree: false }
  }
  let meta: Partial<WorktreeMeta> | undefined = { hostId: 'local', instanceId: 'instance-1' }
  const remoteMeta = { hostId: 'ssh:rival', instanceId: 'rival' }
  const setWorktreeMeta = vi.fn()
  const setWorktreeMetaForHost = vi.fn()
  const store = {
    getSettings: createGlobalSettingsFixture,
    getRepos: () => [{ id: 'repo', path: '/workspace' }],
    getRepo: () => ({ id: 'repo', path: '/workspace' }),
    getProjects: () => [],
    getProjectHostSetups: () => [],
    getWorktreeMeta: vi.fn(() => meta),
    setWorktreeMeta,
    getAllWorktreeMetaForHost: vi.fn((host: string) => ({
      [id]: host === 'local' ? meta : remoteMeta
    })),
    setWorktreeMetaForHost
  }
  // The real runtime owner executes; only its external store and worktree discovery are fixtures.
  const runtime = Reflect.construct(OrcaRuntimeService, [store])
  runtime.resolveWorktreeSelector = vi.fn(async () => row)
  let finish!: (value: GitPushTarget) => void
  mocks.materialize.mockReturnValue(
    new Promise<GitPushTarget>((resolve) => {
      finish = resolve
    })
  )
  const start = async () => {
    const pending = runtime.gitCommands.fetchRuntimeGit(`id:${id}`, pushTarget)
    await vi.waitFor(() => expect(mocks.materialize).toHaveBeenCalledOnce())
    return { pending, finish: () => finish(pushTarget) }
  }
  return {
    runtime,
    row,
    store,
    start,
    setWorktreeMeta,
    setWorktreeMetaForHost,
    replaceMeta: (next: Partial<WorktreeMeta> | undefined) => {
      meta = next
    }
  }
}

describe('runtime push target real metadata owner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.blocked.mockReturnValue(false)
  })

  it('writes only the original local partition when another host has the same ID', async () => {
    const f = fixture()
    const operation = await f.start()
    operation.finish()
    await operation.pending
    expect(f.setWorktreeMetaForHost).toHaveBeenCalledExactlyOnceWith(id, 'local', { pushTarget })
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it.each([
    'reconnect',
    'replace',
    'remove',
    'host',
    'path',
    'wsl-move',
    'unknown-instance',
    'wrong-meta-host',
    'partial-qualified'
  ])('does not write after %s during materialization', async (change) => {
    const f = fixture()
    const operation = await f.start()
    if (change === 'reconnect') {
      f.runtime.store = { ...f.store }
    }
    if (change === 'replace') {
      f.replaceMeta({ hostId: 'local', instanceId: 'instance-2' })
    }
    if (change === 'remove') {
      f.replaceMeta(undefined)
    }
    if (change === 'host') {
      f.row.hostId = 'ssh:rival'
    }
    if (change === 'path') {
      f.row.path = '/replacement'
    }
    if (change === 'wsl-move') {
      mocks.blocked.mockReturnValue(true)
    }
    if (change === 'unknown-instance') {
      f.row.instanceId = ''
    }
    if (change === 'wrong-meta-host') {
      f.replaceMeta({ hostId: 'ssh:rival', instanceId: 'instance-1' })
    }
    if (change === 'partial-qualified') {
      Reflect.deleteProperty(f.store, 'getAllWorktreeMetaForHost')
    }
    operation.finish()
    await operation.pending
    expect(f.setWorktreeMetaForHost).not.toHaveBeenCalled()
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })
  it('uses the legacy store only for a proven local owner without any qualified APIs', async () => {
    const f = fixture()
    Reflect.deleteProperty(f.store, 'getAllWorktreeMetaForHost')
    Reflect.deleteProperty(f.store, 'setWorktreeMetaForHost')
    const operation = await f.start()
    operation.finish()
    await operation.pending
    expect(f.setWorktreeMeta).toHaveBeenCalledExactlyOnceWith(id, { pushTarget })
    expect(f.setWorktreeMetaForHost).not.toHaveBeenCalled()
  })

  it('refuses remote execution before materialization even without qualified APIs', async () => {
    const f = fixture()
    f.row.hostId = 'ssh:rival'
    Reflect.deleteProperty(f.store, 'getAllWorktreeMetaForHost')
    Reflect.deleteProperty(f.store, 'setWorktreeMetaForHost')
    await expect(f.runtime.gitCommands.fetchRuntimeGit(`id:${id}`, pushTarget)).rejects.toThrow()
    expect(mocks.materialize).not.toHaveBeenCalled()
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('refuses a reconnect while the final owner lookup awaits', async () => {
    const f = fixture()
    const operation = await f.start()
    f.runtime.resolveWorktreeSelector = async () => {
      f.runtime.store = { ...f.store }
      return f.row
    }
    operation.finish()
    await operation.pending
    expect(f.setWorktreeMetaForHost).not.toHaveBeenCalled()
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('refuses an unavailable final owner instead of writing cached metadata', async () => {
    const f = fixture()
    const operation = await f.start()
    f.runtime.resolveWorktreeSelector = async () => {
      throw new Error('removed')
    }
    operation.finish()
    await operation.pending
    expect(f.setWorktreeMetaForHost).not.toHaveBeenCalled()
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('refuses a changed WSL route during materialization', async () => {
    const f = fixture()
    const resolve = f.runtime.resolveRuntimeGitTarget.bind(f.runtime)
    let distro = 'Ubuntu'
    f.runtime.resolveRuntimeGitTarget = async (selector: string) => ({
      ...(await resolve(selector)),
      localGitOptions: { wslDistro: distro }
    })
    const operation = await f.start()
    distro = 'Debian'
    operation.finish()
    await operation.pending
    expect(f.setWorktreeMetaForHost).not.toHaveBeenCalled()
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })
  it.each(['hostId', 'instanceId'])('skips bookkeeping without an initial %s', async (key) => {
    const f = fixture()
    Reflect.deleteProperty(f.row, key)
    const operation = await f.start()
    operation.finish()
    await operation.pending
    expect(f.setWorktreeMetaForHost).not.toHaveBeenCalled()
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('preserves an unchanged WSL route and checks the fence with its original host and path', async () => {
    const f = fixture()
    const resolve = f.runtime.resolveRuntimeGitTarget.bind(f.runtime)
    f.runtime.resolveRuntimeGitTarget = async (selector: string) => ({
      ...(await resolve(selector)),
      localGitOptions: { wslDistro: 'Ubuntu' }
    })
    const operation = await f.start()
    operation.finish()
    await operation.pending
    expect(mocks.materialize).toHaveBeenCalledWith('/workspace', pushTarget, undefined, 'repo', {
      wslDistro: 'Ubuntu'
    })
    expect(mocks.blocked).toHaveBeenCalledWith(id, 'local', '/workspace')
    expect(f.setWorktreeMetaForHost).toHaveBeenCalledExactlyOnceWith(id, 'local', { pushTarget })
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })
})
