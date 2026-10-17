import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { Store } from '../persistence'
import type { Repo } from '../../shared/repo-types'
import { listWorktreeRootsWithConcurrency } from './registered-worktree-root-probes'
import { PATH_ACCESS_DENIED_MESSAGE, resolveAuthorizedPath } from './filesystem-auth'

const scratch: string[] = []
function git(path: string, args: string[]) {
  execFileSync('git', ['-C', path, ...args], { windowsHide: true, stdio: 'pipe' })
}
function storeFor(path: string): { store: Store; repo: Repo } {
  const repo: Repo = {
    id: 'owner',
    path,
    kind: 'git',
    displayName: 'repo',
    badgeColor: '#000',
    addedAt: 0
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: authorization reads only these store accessors.
  const store = {
    getRepos: () => [repo],
    getProjectGroups: () => [],
    getFolderWorkspaces: () => [],
    getSettings: () => ({})
  } as unknown as Store
  return { store, repo }
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-graph-authority-')))
  scratch.push(root)
  const main = join(root, 'main')
  await mkdir(main)
  git(main, ['init', '-q'])
  git(main, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'fixture'
  ])
  const linked = join(root, 'linked')
  git(main, ['worktree', 'add', '-q', '-b', 'linked', linked])
  return { root, main, linked }
}
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it('does not authorize an ancestor Git graph after a nested repository loses its metadata', async () => {
  const { main, linked } = await fixture()
  const nested = join(main, 'nested')
  await mkdir(nested)
  git(nested, ['init', '-q'])
  await rm(join(nested, '.git'), { recursive: true, force: true })
  const outside = join(linked, 'secret.txt')
  await writeFile(outside, 'secret')
  const { store, repo } = storeFor(nested)
  const [listed] = await listWorktreeRootsWithConcurrency(store, [repo])
  expect([...listed.roots]).toEqual([nested])
  expect(listed.listingFailed).toBe(true)
  await expect(resolveAuthorizedPath(outside, store)).rejects.toThrow(PATH_ACCESS_DENIED_MESSAGE)
})

it.each(['main', 'linked', 'alias'] as const)(
  'authorizes a real %s root and its linked worktree graph',
  async (kind) => {
    const { root, main, linked } = await fixture()
    const alias = join(root, 'alias')
    if (kind === 'alias') {
      await symlink(main, alias, process.platform === 'win32' ? 'junction' : 'dir')
    }
    const registered = kind === 'main' ? main : kind === 'linked' ? linked : alias
    const { store, repo } = storeFor(registered)
    const [listed] = await listWorktreeRootsWithConcurrency(store, [repo])
    expect(listed.listingFailed).toBe(false)
    expect(listed.roots.has(main)).toBe(true)
    expect(listed.roots.has(linked)).toBe(true)
  }
)

it.skipIf(process.platform !== 'win32')(
  'proves Windows case aliases through the actual filesystem',
  async () => {
    const { main, linked } = await fixture()
    const { store, repo } = storeFor(main.toUpperCase())
    const [listed] = await listWorktreeRootsWithConcurrency(store, [repo])
    expect(listed.listingFailed).toBe(false)
    expect(listed.roots.has(linked)).toBe(true)
  }
)
