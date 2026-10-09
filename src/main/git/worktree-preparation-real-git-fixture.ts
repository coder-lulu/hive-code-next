import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import * as gitRunner from './runner'

const tempRoots: string[] = []
const preparationCleanups: (() => Promise<void>)[] = []

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  }).trim()
}

export async function createRepo(): Promise<{ repoPath: string; root: string }> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), 'orca-prepared-worktree-')))
  tempRoots.push(root)
  const repoPath = join(root, 'repo')
  execFileSync('git', ['init', '--quiet', repoPath], { windowsHide: true })
  git(repoPath, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  git(repoPath, ['config', 'user.email', 'test@example.com'])
  git(repoPath, ['config', 'user.name', 'Test User'])
  git(repoPath, ['config', 'core.autocrlf', 'false'])
  await writeFile(join(repoPath, 'version.txt'), 'one\n')
  git(repoPath, ['add', 'version.txt'])
  git(repoPath, ['commit', '--quiet', '-m', 'initial'])
  return { repoPath, root }
}

export function observeRegistration() {
  const original = gitRunner.gitExecFileAsync
  const { promise: registered, resolve } = Promise.withResolvers<void>()
  const spy = vi.spyOn(gitRunner, 'gitExecFileAsync').mockImplementation(async (args, options) => {
    const result = await original(args, options)
    if (args.includes('worktree') && args[args.indexOf('worktree') + 1] === 'add') {
      resolve()
    }
    return result
  })
  return { registered, spy }
}

export function trackPreparationCleanup(cleanup: () => Promise<void>): void {
  preparationCleanups.push(cleanup)
}

export async function settlePreparationFixtures(): Promise<void> {
  await Promise.all(preparationCleanups.splice(0).map((cleanup) => cleanup()))
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
}
