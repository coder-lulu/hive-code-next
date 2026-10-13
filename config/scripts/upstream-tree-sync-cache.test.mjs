import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createGit } from './upstream-sync-checkpoint.mjs'
import { frozenTreeGit } from './upstream-tree-sync.mjs'

it('bounds immutable reads within one recomputation while observing changed refs and retrying errors', () => {
  const root = resolve('logs/upstream-tree-cache-tests')
  mkdirSync(root, { recursive: true })
  const cwd = mkdtempSync(join(root, 'repo-'))
  const raw = createGit(cwd)
  raw(['init'])
  raw(['config', 'user.name', 'Cache Fixture'])
  raw(['config', 'user.email', 'fixture@example.test'])
  const commit = (text) => {
    writeFileSync(join(cwd, 'value.txt'), text)
    raw(['add', 'value.txt'])
    raw(['-c', 'commit.gpgSign=false', 'commit', '-m', text])
    return raw(['rev-parse', 'HEAD']).trim()
  }
  const first = commit('first')
  const observed = vi.fn(raw)
  const read = frozenTreeGit(observed)
  for (const args of [
    ['ls-tree', '-z', first],
    ['show', `${first}:value.txt`]
  ]) {
    expect(read(args)).toBe(read(args))
    expect(
      observed.mock.calls.filter(([call]) => JSON.stringify(call.slice(1)) === JSON.stringify(args))
    ).toHaveLength(1)
  }
  expect(read(['show', 'HEAD:value.txt'])).toBe('first')
  const second = commit('second')
  expect(read(['show', 'HEAD:value.txt'])).toBe('second')
  expect(read(['show', `${first}:value.txt`])).toBe('first')
  const revisions = [first, second, first].map((sha) => `${sha}^{tree}`)
  const treeShas = read(['rev-parse', '--revs-only', '--end-of-options', ...revisions])
    .trim()
    .split(/\r?\n/)
  expect(treeShas).toEqual(
    revisions.map((revision) => raw(['rev-parse', '--verify', revision]).trim())
  )
  const missing = ['show', `${first}:absent.txt`]
  expect(() => read(missing)).toThrow()
  expect(() => read(missing)).toThrow()
  expect(observed.mock.calls.filter(([call]) => call.at(-1) === missing[1])).toHaveLength(2)
  frozenTreeGit(observed)(['show', `${first}:value.txt`])
  expect(observed.mock.calls.filter(([call]) => call.at(-1) === `${first}:value.txt`)).toHaveLength(
    2
  )
  expect(observed.mock.calls.every(([call]) => call[0] === '--no-replace-objects')).toBe(true)
}, 60000)
