import { execFileSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_GIT_STATUS_LIMIT } from '../../../shared/git-status-limit'
import { stageGitWorktreeScope } from '../../../shared/git-stage-worktree-scope'
import { getStatus } from '../status'
import { bulkStageFiles, stageWorktreeChanges } from './staging'

const tempRoots: string[] = []
const OVER_CAP = DEFAULT_GIT_STATUS_LIMIT + 50

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
}

function names(repo: string, args: string[]): string[] {
  return git(repo, args).split('\n').filter(Boolean)
}

async function createSharedDirectoryLink(target: string, link: string): Promise<void> {
  // Match worktree-symlinks.ts: local Windows directories use unprivileged junctions.
  // Include a child so assertions also detect accidentally staging through the link.
  await writeFile(path.join(target, 'shared-only.txt'), 'shared owner content\n')
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  expect((await lstat(link)).isSymbolicLink()).toBe(true)
}

function expectedVisibleSharedLinks(): string[] {
  // Git treats a junction as a directory, so node_modules/ ignores it on Windows.
  // POSIX directory symlinks remain visible under the same directory-only rule.
  return process.platform === 'win32' ? [] : ['node_modules']
}

async function createRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'orca-stage-worktree-'))
  tempRoots.push(repo)
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test User'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  return repo
}

async function createOverCapRepo(): Promise<string> {
  const repo = await createRepo()
  await mkdir(path.join(repo, 'big'))
  for (let i = 0; i < OVER_CAP; i++) {
    await writeFile(path.join(repo, 'big', `f${String(i).padStart(5, '0')}.txt`), 'a\n')
  }
  git(repo, ['add', '.'])
  git(repo, ['commit', '-q', '-m', 'initial'])
  for (let i = 0; i < OVER_CAP; i++) {
    await writeFile(path.join(repo, 'big', `f${String(i).padStart(5, '0')}.txt`), 'b\n')
  }
  await writeFile(path.join(repo, 'zz-new.txt'), 'new\n')
  return repo
}

async function createConflictRepo(): Promise<string> {
  const repo = await createRepo()
  await writeFile(path.join(repo, 'conflict.txt'), 'base\n')
  await writeFile(path.join(repo, 'tracked.txt'), 'base\n')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-q', '-m', 'base'])
  git(repo, ['checkout', '-q', '-b', 'side'])
  await writeFile(path.join(repo, 'conflict.txt'), 'side\n')
  git(repo, ['commit', '-q', '-am', 'side'])
  git(repo, ['checkout', '-q', 'main'])
  await writeFile(path.join(repo, 'conflict.txt'), 'main\n')
  git(repo, ['commit', '-q', '-am', 'main'])
  try {
    git(repo, ['merge', '-q', 'side'])
  } catch {
    // Expected: the merge stops on conflict.txt.
  }
  await writeFile(path.join(repo, 'tracked.txt'), 'changed\n')
  await writeFile(path.join(repo, 'untracked.txt'), 'new\n')
  return repo
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('stageWorktreeChanges', () => {
  it('keeps the shared algorithm case-sensitive by default for POSIX and WSL owners', async () => {
    const staged: string[] = []
    await stageGitWorktreeScope(
      'all',
      async (args, stdin) => {
        if (args[0] === 'ls-files' && args.includes('--others')) {
          return {
            stdout:
              'NODE_MODULES/shared-only.txt\0node_modules/local-only.txt\0NODE_MODULES_OTHER/local.txt\0'
          }
        }
        if (args[0] === 'add' && stdin !== undefined) {
          staged.push(stdin)
        }
        return { stdout: '' }
      },
      { excludedUntrackedPaths: ['NODE_MODULES'] }
    )
    expect(staged.join('')).toBe(
      ':(literal)node_modules/local-only.txt\0:(literal)NODE_MODULES_OTHER/local.txt\0'
    )
  })

  it('stages every change when the status listing hit its cap', async () => {
    const repo = await createOverCapRepo()
    const status = await getStatus(repo)
    expect(status.didHitLimit).toBe(true)
    const listed = status.entries.map((entry) => entry.path)

    // The old Stage All: only the capped listing reaches git.
    await bulkStageFiles(repo, listed)
    expect(names(repo, ['diff', '--name-only']).length).toBeGreaterThan(0)

    git(repo, ['reset', '-q'])
    await stageWorktreeChanges(repo, 'all')
    expect(names(repo, ['diff', '--name-only'])).toEqual([])
    expect(names(repo, ['ls-files', '--others', '--exclude-standard'])).toEqual([])
    expect(names(repo, ['diff', '--cached', '--name-only'])).toHaveLength(OVER_CAP + 1)
  })

  it('stages only tracked changes for the tracked scope', async () => {
    const repo = await createOverCapRepo()

    await stageWorktreeChanges(repo, 'tracked')

    expect(names(repo, ['diff', '--name-only'])).toEqual([])
    expect(names(repo, ['ls-files', '--others', '--exclude-standard'])).toEqual(['zz-new.txt'])
  })

  it('leaves unresolved conflicts unstaged', async () => {
    const repo = await createConflictRepo()

    await stageWorktreeChanges(repo, 'all')

    expect(names(repo, ['diff', '--name-only', '--diff-filter=U'])).toEqual(['conflict.txt'])
    expect(names(repo, ['diff', '--cached', '--name-only', '--diff-filter=M'])).toEqual([
      'tracked.txt'
    ])
    expect(names(repo, ['diff', '--cached', '--name-only', '--diff-filter=A'])).toEqual([
      'untracked.txt'
    ])
  })
  it('stays inside a folder workspace nested in a larger repo', async () => {
    const repo = await createRepo()
    await mkdir(path.join(repo, 'folder'))
    await writeFile(path.join(repo, 'folder', 'inside.txt'), 'a\n')
    await writeFile(path.join(repo, 'outside.txt'), 'a\n')
    git(repo, ['add', '.'])
    git(repo, ['commit', '-q', '-m', 'initial'])
    await writeFile(path.join(repo, 'folder', 'inside.txt'), 'b\n')
    await writeFile(path.join(repo, 'outside.txt'), 'b\n')
    await writeFile(path.join(repo, 'folder', 'new.txt'), 'new\n')

    await stageWorktreeChanges(path.join(repo, 'folder'), 'all')

    expect(names(repo, ['diff', '--cached', '--name-only'])).toEqual([
      'folder/inside.txt',
      'folder/new.txt'
    ])
    expect(names(repo, ['diff', '--name-only'])).toEqual(['outside.txt'])
  })

  it('leaves unresolved conflicts unstaged in a nested folder too', async () => {
    const repo = await createConflictRepo()
    await mkdir(path.join(repo, 'sub'))
    await writeFile(path.join(repo, 'sub', 'new.txt'), 'new\n')

    await stageWorktreeChanges(path.join(repo, 'sub'), 'all')

    expect(names(repo, ['diff', '--name-only', '--diff-filter=U'])).toEqual(['conflict.txt'])
    expect(names(repo, ['diff', '--cached', '--name-only', '--diff-filter=A'])).toEqual([
      'sub/new.txt'
    ])
  })

  describe('Orca shared symlinks', () => {
    it.each([false, true])('honors verified shared path casing (conflict=%s)', async (conflict) => {
      const repo = conflict ? await createConflictRepo() : await createRepo()
      if (!conflict) {
        await writeFile(path.join(repo, 'tracked.txt'), 'base\n')
        git(repo, ['add', '.'])
        git(repo, ['commit', '-q', '-m', 'initial'])
        await writeFile(path.join(repo, 'tracked.txt'), 'changed\n')
        await writeFile(path.join(repo, 'untracked.txt'), 'new\n')
      }
      const owner = await mkdtemp(path.join(tmpdir(), 'orca-stage-owner-'))
      tempRoots.push(owner)
      const linkName = process.platform === 'win32' ? 'node_modules' : 'NODE_MODULES'
      await createSharedDirectoryLink(owner, path.join(repo, linkName))
      expect((await lstat(path.join(repo, 'NODE_MODULES'))).isSymbolicLink()).toBe(true)
      if (process.platform !== 'win32') {
        await mkdir(path.join(repo, 'node_modules'))
        await writeFile(path.join(repo, 'node_modules', 'local-only.txt'), 'different directory\n')
      }

      await stageWorktreeChanges(repo, 'all', { sharedLinkPaths: ['NODE_MODULES'] })

      expect(names(repo, ['diff', '--cached', '--name-only', '--diff-filter=A'])).toEqual(
        process.platform === 'win32'
          ? ['untracked.txt']
          : ['node_modules/local-only.txt', 'untracked.txt']
      )
      expect(names(repo, ['diff', '--cached', '--name-only', '--diff-filter=M'])).toEqual([
        'tracked.txt'
      ])
      expect(names(repo, ['diff', '--name-only', '--diff-filter=U'])).toEqual(
        conflict ? ['conflict.txt'] : []
      )
    })

    it.each([false, true])(
      'stages only visible files with an empty index (emptyCommit=%s)',
      async (emptyCommit) => {
        const repo = await createRepo()
        if (emptyCommit) {
          git(repo, ['commit', '-q', '--allow-empty', '-m', 'empty initial'])
        }
        const owner = await mkdtemp(path.join(tmpdir(), 'orca-stage-owner-'))
        tempRoots.push(owner)
        await createSharedDirectoryLink(owner, path.join(repo, 'node_modules'))
        await writeFile(path.join(repo, 'untracked.txt'), 'new\n')
        expect(names(repo, ['ls-files'])).toEqual([])

        await stageWorktreeChanges(repo, 'all', { sharedLinkPaths: ['node_modules'] })

        expect(names(repo, ['diff', '--cached', '--name-only'])).toEqual(['untracked.txt'])
      }
    )

    async function createSharedLinkWorktree(): Promise<{ repo: string; owner: string }> {
      const repo = await createRepo()
      const owner = await mkdtemp(path.join(tmpdir(), 'orca-stage-owner-'))
      tempRoots.push(owner)
      await mkdir(path.join(owner, 'node_modules'))
      // A directory-only ignore hides Windows junctions but not POSIX symlinks.
      await writeFile(path.join(repo, '.gitignore'), 'node_modules/\n')
      git(repo, ['add', '.'])
      git(repo, ['commit', '-q', '-m', 'initial'])
      await createSharedDirectoryLink(
        path.join(owner, 'node_modules'),
        path.join(repo, 'node_modules')
      )
      await writeFile(path.join(repo, 'new.txt'), 'new\n')
      return { repo, owner }
    }

    it('never stages the shared link for scope all', async () => {
      const { repo } = await createSharedLinkWorktree()

      const receipt = await stageWorktreeChanges(repo, 'all', { sharedLinkPaths: ['node_modules'] })

      expect(receipt).toEqual({ stagedScope: 'all' })
      expect(names(repo, ['diff', '--cached', '--name-only'])).toEqual(['new.txt'])
      expect(names(repo, ['ls-files', '--others', '--exclude-standard'])).toEqual(
        expectedVisibleSharedLinks()
      )
    })

    it('never stages contents through an unignored shared link without a conflict', async () => {
      const { repo } = await createSharedLinkWorktree()
      await writeFile(path.join(repo, '.gitignore'), '')
      git(repo, ['add', '.gitignore'])
      git(repo, ['commit', '-q', '-m', 'remove directory ignore'])

      await stageWorktreeChanges(repo, 'all', { sharedLinkPaths: ['node_modules'] })

      expect(names(repo, ['diff', '--cached', '--name-only'])).toEqual(['new.txt'])
    })

    it('never stages the shared link while a conflict is unresolved', async () => {
      const repo = await createConflictRepo()
      const owner = await mkdtemp(path.join(tmpdir(), 'orca-stage-owner-'))
      tempRoots.push(owner)
      await createSharedDirectoryLink(owner, path.join(repo, 'node_modules'))

      await stageWorktreeChanges(repo, 'all', { sharedLinkPaths: ['node_modules'] })

      expect(names(repo, ['diff', '--cached', '--name-only', '--diff-filter=A'])).toEqual([
        'untracked.txt'
      ])
      expect(names(repo, ['diff', '--name-only', '--diff-filter=U'])).toEqual(['conflict.txt'])
    })

    // Why these spellings: the Shared Paths setting saves them as typed, and git prints neither.
    describe.each(['./node_modules', 'node_modules/'])('saved as %s', (sharedPath) => {
      it('never stages the shared link', async () => {
        const { repo } = await createSharedLinkWorktree()

        await stageWorktreeChanges(repo, 'all', { sharedLinkPaths: [sharedPath] })

        expect(names(repo, ['diff', '--cached', '--name-only'])).toEqual(['new.txt'])
      })

      it('never stages the shared link while a conflict is unresolved', async () => {
        const repo = await createConflictRepo()
        const owner = await mkdtemp(path.join(tmpdir(), 'orca-stage-owner-'))
        tempRoots.push(owner)
        await createSharedDirectoryLink(owner, path.join(repo, 'node_modules'))

        await stageWorktreeChanges(repo, 'all', { sharedLinkPaths: [sharedPath] })

        expect(names(repo, ['diff', '--cached', '--name-only', '--diff-filter=A'])).toEqual([
          'untracked.txt'
        ])
        expect(names(repo, ['diff', '--name-only', '--diff-filter=U'])).toEqual(['conflict.txt'])
      })

      it.each([true, false])(
        'never stages the shared link from an over-cap listing with a conflict (ignored=%s)',
        async (ignored) => {
          const repo = await createConflictRepo()
          const owner = await mkdtemp(path.join(tmpdir(), 'orca-stage-owner-'))
          tempRoots.push(owner)
          await mkdir(path.join(owner, 'node_modules'))
          await writeFile(path.join(repo, '.gitignore'), ignored ? 'node_modules/\n' : '')
          await createSharedDirectoryLink(
            path.join(owner, 'node_modules'),
            path.join(repo, 'node_modules')
          )
          await mkdir(path.join(repo, 'big'))
          for (let i = 0; i < OVER_CAP; i++) {
            await writeFile(path.join(repo, 'big', `f${String(i).padStart(5, '0')}.txt`), 'a\n')
          }
          expect((await getStatus(repo)).didHitLimit).toBe(true)

          await stageWorktreeChanges(repo, 'all', { sharedLinkPaths: [sharedPath] })

          const added = names(repo, ['diff', '--cached', '--name-only', '--diff-filter=A'])
          expect(added).toHaveLength(OVER_CAP + 2)
          expect(
            added.some((name) => name === 'node_modules' || name.startsWith('node_modules/'))
          ).toBe(false)
          expect(names(repo, ['ls-files', '--others', '--exclude-standard'])).toEqual(
            ignored
              ? expectedVisibleSharedLinks()
              : process.platform === 'win32'
                ? ['node_modules/shared-only.txt']
                : ['node_modules']
          )
          expect(names(repo, ['diff', '--name-only', '--diff-filter=U'])).toEqual(['conflict.txt'])
        }
      )
    })

    it('still stages a regular file the user put at a shared name', async () => {
      const repo = await createRepo()
      git(repo, ['commit', '-q', '--allow-empty', '-m', 'initial'])
      await writeFile(path.join(repo, 'node_modules'), 'not a link\n')

      await stageWorktreeChanges(repo, 'all', { sharedLinkPaths: ['node_modules'] })

      expect(names(repo, ['diff', '--cached', '--name-only'])).toEqual(['node_modules'])
    })
  })
})
