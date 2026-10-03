import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { recoverLocalWindowsWorktreeRemoval } from './local-worktree-removal-recovery'

const tempRoots: string[] = []

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

describe('local Windows worktree removal recovery (live Git)', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }))
    )
  })

  it.runIf(process.platform === 'win32')(
    'finishes deletion when Git is deregistered but a residual directory remains',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'orca-worktree-enotempty-'))
      tempRoots.push(root)
      const repoPath = path.join(root, 'repo')
      const worktreePath = path.join(root, 'worktree')

      git(root, ['init', '--quiet', repoPath])
      git(repoPath, ['config', 'user.email', 'test@example.com'])
      git(repoPath, ['config', 'user.name', 'Test User'])
      await writeFile(path.join(repoPath, '.gitignore'), 'churn/\n')
      git(repoPath, ['add', '.gitignore'])
      git(repoPath, ['commit', '--quiet', '-m', 'initial'])
      git(repoPath, ['worktree', 'add', '--quiet', '-b', 'feature/churn', worktreePath])
      const head = git(worktreePath, ['rev-parse', 'HEAD'])

      // Git versions differ in whether a concurrent writer can win the delete
      // race. Build the post-failure state deterministically: live Git removes
      // the registration, then a residual directory represents the ENOTEMPTY
      // payload the recovery path must finish deleting.
      const removal = spawnSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoPath,
        encoding: 'utf8'
      })
      expect(removal.status).toBe(0)
      expect(git(repoPath, ['worktree', 'list', '--porcelain'])).not.toContain(worktreePath)
      await mkdir(path.join(worktreePath, 'churn'), { recursive: true })
      await writeFile(path.join(worktreePath, 'churn', 'residual.txt'), 'x')
      expect(existsSync(worktreePath)).toBe(true)

      await expect(
        recoverLocalWindowsWorktreeRemoval({
          error: Object.assign(new Error('git worktree remove failed'), {
            stderr: 'failed to delete residual worktree directory'
          }),
          force: false,
          canonicalWorktreePath: worktreePath,
          repoPath,
          localWorktreeGitOptions: {},
          registeredWorktree: { branch: 'refs/heads/feature/churn', head },
          deleteBranch: false,
          closeWatcher: async () => {}
        })
      ).resolves.toEqual({})

      expect(existsSync(worktreePath)).toBe(false)
    }
  )
})
