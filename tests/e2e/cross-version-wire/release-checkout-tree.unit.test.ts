import type { Dirent } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { extractReleaseCheckoutTree } from './release-checkout-tree'

const fixture = vi.hoisted(() => ({
  directories: new Map<string, Dirent<string>[]>(),
  readSource: vi.fn(async (_path: string) => '')
}))

vi.mock('../../../src/shared/child-process/run-process', () => ({ runProcess: vi.fn() }))
vi.mock('node:fs/promises', () => ({
  readFile: fixture.readSource,
  readdir: vi.fn(async (path: string) => fixture.directories.get(path) ?? []),
  rm: vi.fn(),
  writeFile: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
  fixture.directories.clear()
  fixture.readSource.mockReset()
  vi.mocked(runProcess).mockResolvedValue({
    code: 0,
    signal: null,
    timedOut: false,
    stdout: '',
    stderr: ''
  })
})

it('excludes discarded test sources before they consume the shared extraction deadline', async () => {
  await extractReleaseCheckoutTree('/repository', '/staging', 'a'.repeat(40))
  const archive = vi.mocked(runProcess).mock.calls[0][0]
  expect(archive.program).toBe('git')
  expect(archive.args?.slice(4)).toEqual([
    '--',
    'src/main',
    'src/shared',
    'src/preload',
    'src/renderer',
    'src/types',
    'mobile/src/worktree/agent-row-display.ts',
    ':(glob,exclude)**/*.test.ts',
    ':(glob,exclude)**/*.test.tsx',
    ':(glob,exclude)**/*.bench.ts',
    ':(glob,exclude)**/*.bench.tsx',
    ':(glob,exclude)**/*.spec.ts',
    ':(glob,exclude)**/*.spec.tsx'
  ])
  const extraction = vi.mocked(runProcess).mock.calls[1][0]
  expect(extraction.args).toEqual(
    expect.arrayContaining([
      '--exclude=*.test.ts',
      '--exclude=*.test.tsx',
      '--exclude=*.spec.ts',
      '--exclude=*.spec.tsx',
      '--exclude=*.bench.ts',
      '--exclude=*.bench.tsx'
    ])
  )
  expect(extraction.timeoutMs).toBeLessThanOrEqual(45_000)
  expect(extraction.terminationBarrier).toBe(true)
})

function treeEntry(name: string, kind: 'file' | 'directory' | 'symlink' = 'file'): Dirent {
  return {
    name,
    parentPath: '',
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'directory',
    isSymbolicLink: () => kind === 'symlink',
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false
  }
}

it('prepares every nested source and alias with bounded concurrent filesystem work', async () => {
  const sourceRoot = join('/staging', 'src')
  const names = Array.from({ length: 16 }, (_, index) => `source-${index}.ts`)
  fixture.directories.set(sourceRoot, [
    ...names.map((name) => treeEntry(name)),
    treeEntry('nested', 'directory'),
    treeEntry('outside.ts', 'symlink')
  ])
  fixture.directories.set(join(sourceRoot, 'nested'), [
    treeEntry('source.tsx'),
    treeEntry('discard.test.ts'),
    treeEntry('discard.bench.tsx'),
    treeEntry('discard.spec.ts'),
    treeEntry('asset.txt')
  ])
  let active = 0
  let peak = 0
  fixture.readSource.mockImplementation(async () => {
    active++
    peak = Math.max(peak, active)
    await Promise.resolve()
    active--
    return "import value from '@/value'\nconst lazy = import('@renderer/lazy')\nconst required = require('@/required')\n"
  })

  await extractReleaseCheckoutTree('/repository', '/staging', 'a'.repeat(40))

  expect(peak).toBe(8)
  expect(active).toBe(0)
  expect(readFile).toHaveBeenCalledTimes(17)
  expect(writeFile).toHaveBeenCalledTimes(17)
  for (const name of names) {
    expect(writeFile).toHaveBeenCalledWith(
      join(sourceRoot, name),
      "import value from './renderer/src/value'\nconst lazy = import('./renderer/src/lazy')\nconst required = require('./renderer/src/required')\n"
    )
  }
  expect(writeFile).toHaveBeenCalledWith(
    join(sourceRoot, 'nested', 'source.tsx'),
    "import value from '../renderer/src/value'\nconst lazy = import('../renderer/src/lazy')\nconst required = require('../renderer/src/required')\n"
  )
  for (const name of ['discard.test.ts', 'discard.bench.tsx', 'discard.spec.ts']) {
    expect(rm).toHaveBeenCalledWith(join(sourceRoot, 'nested', name))
  }
  expect(readFile).not.toHaveBeenCalledWith(join(sourceRoot, 'nested', 'asset.txt'), 'utf8')
  expect(readFile).not.toHaveBeenCalledWith(join(sourceRoot, 'outside.ts'), 'utf8')
})

it('rejects a failed source only after every already-issued sibling operation settles', async () => {
  const sourceRoot = join('/staging', 'src')
  fixture.directories.set(
    sourceRoot,
    Array.from({ length: 16 }, (_, index) => treeEntry(`source-${index}.ts`))
  )
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate
  })
  let active = 0
  let settled = false
  fixture.readSource.mockImplementation(async (path) => {
    if (path === join(sourceRoot, 'source-0.ts')) {
      throw new Error('unreadable checkout source')
    }
    active++
    await gate
    active--
    return 'export const intact = true\n'
  })
  const extraction = extractReleaseCheckoutTree('/repository', '/staging', 'a'.repeat(40))
  const outcome = extraction.then(
    () => {
      settled = true
      return null
    },
    (error: unknown) => {
      settled = true
      return error
    }
  )
  try {
    await vi.waitFor(() => expect(active).toBe(7))
    expect(settled).toBe(false)
  } finally {
    release()
    await outcome
  }

  await expect(extraction).rejects.toThrow('unreadable checkout source')
  expect(active).toBe(0)
  expect(readFile).toHaveBeenCalledTimes(8)
  expect(writeFile).not.toHaveBeenCalled()
})
