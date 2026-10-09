import { mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from './child-process/run-process'
import type * as GitCommonDirectory from './git-common-directory'
import { createUntitledPlaceholderRetentionHost } from './untitled-placeholder-retention'
import { resolveUntitledPlaceholderRetentionRoot } from './untitled-placeholder-recovery-directory'
import type { UntitledPlaceholderRetentionHost } from './untitled-placeholder-retention-types'

const environment = vi.hoisted(() => ({
  userData: null as string | null,
  fixtureRoot: null as string | null
}))
vi.mock('./app-environment', () => ({
  hasAppEnvironment: () => environment.userData !== null,
  getAppEnvironment: () => ({ getPath: () => environment.userData })
}))
vi.mock('./git-common-directory', async (importOriginal) => {
  const actual = await importOriginal<typeof GitCommonDirectory>()
  return {
    ...actual,
    resolveGitCommonDirectory: async (path: string) => {
      if (environment.fixtureRoot) {
        const part = relative(environment.fixtureRoot, path)
        // Model an external non-Git ancestor without bypassing any metadata inside the fixture.
        if (isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`)) {
          return null
        }
      }
      return actual.resolveGitCommonDirectory(path)
    }
  }
})

let directory: string
let repo: string
let hosts: UntitledPlaceholderRetentionHost[]
const OWNER = 'fixture-authenticated-owner'

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runProcess({ program: 'git', cwd, args, timeoutMs: 10_000 })
  expect(result.timedOut).toBe(false)
  expect(result.code, result.stderr).toBe(0)
  return result.stdout
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'untitled-private-git-')))
  environment.fixtureRoot = directory
  repo = join(directory, 'repo')
  await mkdir(repo)
  hosts = []
  environment.userData = null
})

afterEach(async () => {
  await Promise.all(hosts.map((host) => host.releaseOwner(OWNER)))
  environment.userData = null
  await rm(directory, { recursive: true, force: true })
  environment.fixtureRoot = null
})

describe('untitled retained payloads are excluded from project commits', () => {
  it('keeps an actual late FD write in real Git metadata and out of git add -A', async () => {
    await git(repo, ['init', '--quiet'])
    const excludePath = join(repo, '.git', 'info', 'exclude')
    const exclude = await readFile(excludePath)
    const service = createUntitledPlaceholderRetentionHost({
      resolveRetentionRoot: resolveUntitledPlaceholderRetentionRoot
    })
    hosts.push(service)
    const filePath = join(repo, 'untitled.md')
    const token = await service.create(filePath, OWNER)
    const writer = await open(filePath, 'r+')
    try {
      const result = await service.discard(filePath, OWNER, token)
      expect(result.status).toBe('removed-placeholder')
      if (result.status !== 'removed-placeholder') {
        throw new Error('Missing actual capture')
      }
      expect(result.recovery.retainedPath).toContain(
        join(repo, '.git') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')
      )
      await writer.writeFile('private late writer bytes', 'utf8')
      await writer.sync()
      expect(await readFile(result.recovery.retainedPath, 'utf8')).toBe('private late writer bytes')
      await expect(readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
      await git(repo, ['add', '-A'])
      expect(await git(repo, ['ls-files', '-z'])).toBe('')
      expect(await git(repo, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
      expect(await readFile(excludePath)).toEqual(exclude)
    } finally {
      await writer.close()
    }
  })

  it('resolves a linked worktree to the same actual common Git metadata', async () => {
    await git(repo, ['init', '--quiet'])
    await git(repo, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      `core.hooksPath=${join(directory, 'no-hooks')}`,
      'commit',
      '--allow-empty',
      '--quiet',
      '-m',
      'fixture'
    ])
    const linked = join(directory, 'linked')
    await git(repo, ['worktree', 'add', '--quiet', '--detach', linked, 'HEAD'])
    expect(await resolveUntitledPlaceholderRetentionRoot(join(linked, 'untitled.md'))).toBe(
      join(repo, '.git', 'hivecode-untitled-placeholder-recovery')
    )
  })

  it('rejects a separate Git admin directory located in the committable worktree', async () => {
    await git(repo, ['init', '--quiet', '--separate-git-dir', join(repo, 'private-admin')])
    await expect(
      resolveUntitledPlaceholderRetentionRoot(join(repo, 'untitled.md'))
    ).rejects.toThrow('inside the committable worktree')
    await expect(readFile(join(repo, 'untitled.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses a real same-volume app data directory outside a non-Git workspace', async () => {
    const userData = join(directory, 'app-data')
    await mkdir(userData)
    environment.userData = userData
    expect(await resolveUntitledPlaceholderRetentionRoot(join(repo, 'untitled.md'))).toBe(
      join(userData, 'untitled-placeholder-recovery')
    )
  })

  it('rejects admin inside another repository even when an ancestor is named .git', async () => {
    const otherRepo = join(directory, '.git', 'other-repo')
    await mkdir(otherRepo, { recursive: true })
    await git(otherRepo, ['init', '--quiet'])
    const admin = join(otherRepo, 'source-admin')
    await git(repo, ['init', '--quiet', '--separate-git-dir', admin])
    await expect(
      resolveUntitledPlaceholderRetentionRoot(join(repo, 'untitled.md'))
    ).rejects.toThrow('inside another committable worktree')
    await expect(readFile(join(repo, 'untitled.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects app data inside a project and falls back to its actual Git metadata', async () => {
    await git(repo, ['init', '--quiet'])
    const userData = join(repo, 'app-data')
    await mkdir(userData)
    environment.userData = userData
    expect(await resolveUntitledPlaceholderRetentionRoot(join(repo, 'untitled.md'))).toBe(
      join(repo, '.git', 'hivecode-untitled-placeholder-recovery')
    )
  })

  it('fails explicitly without private same-volume host metadata and leaves the source absent', async () => {
    await expect(
      resolveUntitledPlaceholderRetentionRoot(join(repo, 'untitled.md'))
    ).rejects.toThrow('private recovery location')
    await expect(readFile(join(repo, 'untitled.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects malformed Git metadata instead of writing retained bytes into the worktree', async () => {
    await mkdir(join(repo, '.git', 'objects'), { recursive: true })
    await writeFile(join(repo, '.git', 'HEAD'), 'unproved HEAD contents')
    await expect(
      resolveUntitledPlaceholderRetentionRoot(join(repo, 'untitled.md'))
    ).rejects.toThrow('Git recovery metadata is unavailable')
  })
})
