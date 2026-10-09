import { readFileSync, type Dirent } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { extractReleaseCheckoutTree } from './release-checkout-tree'

const fixture = vi.hoisted(() => ({
  directories: new Map<string, Dirent<string>[]>(),
  archiveEntries: ['src/source.ts'],
  readSource: vi.fn(async (_path: string) => '')
}))

vi.mock('../../../src/shared/child-process/run-process', () => ({ runProcess: vi.fn() }))
vi.mock('tar', () => ({
  list: vi.fn(async (options: { onReadEntry: (entry: { type: string; path: string }) => void }) => {
    for (const path of fixture.archiveEntries) {
      options.onReadEntry({ type: 'File', path })
    }
  })
}))
vi.mock('node:fs/promises', () => ({
  readFile: fixture.readSource,
  readdir: vi.fn(async (path: string) => fixture.directories.get(path) ?? []),
  rm: vi.fn(),
  writeFile: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
  fixture.directories.clear()
  fixture.archiveEntries = ['src/source.ts']
  fixture.readSource.mockReset()
  vi.mocked(writeFile).mockReset()
  vi.mocked(runProcess).mockResolvedValue({
    code: 0,
    signal: null,
    timedOut: false,
    stdout: '',
    stderr: ''
  })
})

it('excludes discarded test sources before they consume the shared extraction deadline', async () => {
  await extractReleaseCheckoutTree('/repository', '/staging', 'a'.repeat(40), undefined, 'linux')
  const archive = vi
    .mocked(runProcess)
    .mock.calls.find(([spec]) => spec.args?.[0] === 'archive')![0]
  expect(archive.program).toBe('git')
  expect(archive.args?.slice(4)).toEqual([
    '--',
    'src/main',
    'src/shared',
    'src/preload',
    'src/relay',
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
  const extraction = vi.mocked(runProcess).mock.calls.find(([spec]) => spec.program !== 'git')![0]
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

it('archives the real policy data imported by the current task producers', async () => {
  const policyPaths = new Set<string>()
  for (const producer of [
    'src/main/tasks/task-docker-model-profile.ts',
    'src/main/tasks/task-model-response-configuration.ts'
  ]) {
    const file = resolve(producer)
    for (const match of readFileSync(file, 'utf8').matchAll(
      /\bfrom\s+['"]([^'"]+\/integration\/[^'"]+\.json)['"]/g
    )) {
      policyPaths.add(
        relative(process.cwd(), resolve(dirname(file), match[1]))
          .split(sep)
          .join('/')
      )
    }
  }
  expect(policyPaths.size).toBe(4)
  vi.mocked(runProcess).mockResolvedValueOnce({
    code: 0,
    signal: null,
    timedOut: false,
    stdout: [...policyPaths].join('\n'),
    stderr: ''
  })
  await extractReleaseCheckoutTree('/repository', '/staging', 'a'.repeat(40), undefined, 'linux')
  const query = vi.mocked(runProcess).mock.calls[0][0]
  expect(query.args?.slice(0, 4)).toEqual(['ls-tree', '--name-only', 'a'.repeat(40), '--'])
  expect(query.args?.slice(4)).toEqual(expect.arrayContaining([...policyPaths]))
  const archive = vi
    .mocked(runProcess)
    .mock.calls.find(([spec]) => spec.args?.[0] === 'archive')![0]
  expect(archive.args).toEqual(expect.arrayContaining([...policyPaths]))
  expect(query.timeoutMs).toBeLessThanOrEqual(45_000)
  expect(archive.timeoutMs).toBeLessThanOrEqual(query.timeoutMs!)
  expect(query.terminationBarrier).toBe(true)
})

it('does not archive a guessed policy path when the tracked-path query fails', async () => {
  vi.mocked(runProcess).mockResolvedValueOnce({
    code: 1,
    signal: null,
    timedOut: false,
    stdout: '',
    stderr: 'not an object'
  })
  await expect(
    extractReleaseCheckoutTree('/repository', '/staging', 'a'.repeat(40), undefined, 'linux')
  ).rejects.toThrow('git ls-tree not an object')
  expect(runProcess).toHaveBeenCalledOnce()
  expect(rm).toHaveBeenCalledWith(join('/staging', '.release-checkout.tar'), { force: true })
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

  await extractReleaseCheckoutTree('/repository', '/staging', 'a'.repeat(40), undefined, 'linux')

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
  const extraction = extractReleaseCheckoutTree(
    '/repository',
    '/staging',
    'a'.repeat(40),
    undefined,
    'linux'
  )
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

it('extracts every Windows archive member exactly once with eight bounded owners', async () => {
  fixture.archiveEntries = Array.from({ length: 128 }, (_, index) => `src/source-${index}.ts`)
  await extractReleaseCheckoutTree('/repository', '/staging', 'a'.repeat(40), undefined, 'win32')
  const manifests = vi
    .mocked(writeFile)
    .mock.calls.map(([, contents]) => String(contents).split('\n').filter(Boolean))
  expect(manifests).toHaveLength(8)
  expect(manifests.flat().toSorted()).toEqual(fixture.archiveEntries.toSorted())
  const extractions = vi
    .mocked(runProcess)
    .mock.calls.filter(([spec]) => spec.program !== 'git')
    .map(([spec]) => spec)
  expect(extractions).toHaveLength(8)
  for (const spec of extractions) {
    expect(spec.args).toContain('-T')
    expect(spec.timeoutMs).toBeLessThanOrEqual(45_000)
    expect(spec.terminationBarrier).toBe(true)
  }
  expect(rm).toHaveBeenCalledTimes(9)
})

it('settles every issued Windows extractor before cleaning its manifests or archive', async () => {
  fixture.archiveEntries = Array.from({ length: 128 }, (_, index) => `src/source-${index}.ts`)
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  let issued = 0
  vi.mocked(runProcess).mockImplementation(async (spec) => {
    if (spec.program === 'git') {
      return { code: 0, signal: null, timedOut: false, stdout: '', stderr: '' }
    }
    issued++
    if (issued === 1) {
      return { code: 1, signal: null, timedOut: false, stdout: '', stderr: 'extraction failed' }
    }
    await barrier
    return { code: 0, signal: null, timedOut: false, stdout: '', stderr: '' }
  })
  const extracting = extractReleaseCheckoutTree(
    '/repository',
    '/staging',
    'a'.repeat(40),
    undefined,
    'win32'
  )
  const assertion = expect(extracting).rejects.toThrow('extraction failed')
  try {
    await vi.waitFor(() => expect(issued).toBe(8))
    expect(rm).not.toHaveBeenCalled()
  } finally {
    release()
    await assertion
  }
  expect(rm).toHaveBeenCalledTimes(9)
})

it('settles every manifest write before cleaning a failed Windows preparation', async () => {
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  let issued = 0
  vi.mocked(writeFile).mockImplementation(async () => {
    issued++
    if (issued === 1) {
      throw new Error('manifest write failed')
    }
    await barrier
  })
  const preparing = extractReleaseCheckoutTree(
    '/repository',
    '/staging',
    'a'.repeat(40),
    undefined,
    'win32'
  )
  const assertion = expect(preparing).rejects.toThrow('manifest write failed')
  try {
    await vi.waitFor(() => expect(issued).toBe(8))
    expect(
      vi.mocked(runProcess).mock.calls.map(([spec]) => [spec.program, spec.args?.[0]])
    ).toEqual([
      ['git', 'ls-tree'],
      ['git', 'archive']
    ])
    expect(rm).not.toHaveBeenCalled()
  } finally {
    release()
    await assertion
  }
  expect(rm).toHaveBeenCalledTimes(9)
})
