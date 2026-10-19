import { describe, expect, it } from 'vitest'
import { runProcessSync } from '@orca/process-host'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  resolvePullRequestDiffBase,
  selectPullRequestDiffBase
} from './git-pull-request-diff-base.mjs'

describe('pull request diff base selection', () => {
  it('resolves a usable merge parent with the bounded PR checkout depth', () => {
    const directory = resolve('logs/release-batch/diff-base-fixtures')
    mkdirSync(directory, { recursive: true })
    const root = mkdtempSync(join(directory, 'merge-'))
    const source = join(root, 'source')
    mkdirSync(source)
    const git = (cwd, ...args) => {
      const result = runProcessSync({ program: 'git', args, cwd })
      if (result.code !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
      }
      return result.stdout.trim()
    }
    try {
      git(source, 'init', '-q')
      const tree = git(source, 'mktree')
      const commit = (...parents) =>
        git(
          source,
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          'commit-tree',
          tree,
          ...parents.flatMap((parent) => ['-p', parent]),
          '-m',
          `fixture-${parents.join('-')}`
        )
      const base = commit()
      const head = commit(base)
      const merge = commit(base, head)
      git(source, 'update-ref', 'refs/heads/main', merge)
      git(source, 'symbolic-ref', 'HEAD', 'refs/heads/main')
      for (const depth of [1, 2]) {
        const clone = join(root, `depth-${depth}`)
        git(
          root,
          'clone',
          '--quiet',
          '--depth',
          String(depth),
          '--no-tags',
          pathToFileURL(source).href,
          clone
        )
        const resolved = resolvePullRequestDiffBase(clone, base, 'pull_request')
        expect(resolved).toBe(base)
        if (depth === 1) {
          expect(() => git(clone, 'cat-file', '-e', `${resolved}^{commit}`)).toThrow()
        } else {
          expect(git(clone, 'cat-file', '-e', `${resolved}^{commit}`)).toBe('')
          expect(git(clone, 'diff', '--name-only', resolved, '--')).toBe('')
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('uses the merge commit first parent for pull request checkouts', () => {
    expect(
      selectPullRequestDiffBase('event-base', ['current-base', 'pull-request-head'], 'pull_request')
    ).toBe('current-base')
  })

  it('keeps the requested base outside synthetic pull request merges', () => {
    expect(selectPullRequestDiffBase('requested-base', ['parent'], 'pull_request')).toBe(
      'requested-base'
    )
    expect(selectPullRequestDiffBase('requested-base', ['parent', 'other'], 'push')).toBe(
      'requested-base'
    )
  })
})
