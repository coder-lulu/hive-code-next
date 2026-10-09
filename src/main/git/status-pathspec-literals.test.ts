import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bulkStageFiles, bulkUnstageFiles, stageFile, unstageFile } from './status'

const tempRoots: string[] = []
const pendingOperations: Promise<unknown>[] = []
const globNamedFile = '[k]eep.log'
const globMatchedFile = 'keep.log'

function gitLiteralPathspec(filePath: string): string {
  return `:(literal)${filePath}`
}

async function createRepoWithGlobNamedFiles(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'orca-status-pathspec-'))
  tempRoots.push(repo)
  execFileSync('git', ['init', '-q'], { cwd: repo, windowsHide: true })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repo,
    windowsHide: true
  })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo, windowsHide: true })
  await writeFile(path.join(repo, globNamedFile), 'selected')
  await writeFile(path.join(repo, globMatchedFile), 'keep')
  execFileSync('git', ['add', gitLiteralPathspec(globNamedFile), globMatchedFile], {
    cwd: repo,
    windowsHide: true
  })
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repo, windowsHide: true })
  await writeFile(path.join(repo, globNamedFile), 'selected modified')
  await writeFile(path.join(repo, globMatchedFile), 'keep modified')
  return repo
}

function gitNames(repo: string, args: string[]): string[] {
  const stdout = execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })
  return stdout.split(/\r?\n/).filter(Boolean)
}

afterEach(async () => {
  await Promise.allSettled(pendingOperations.splice(0))
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('git status pathspec literals', () => {
  let repo: string
  beforeEach(async () => {
    const fixture = createRepoWithGlobNamedFiles()
    pendingOperations.push(fixture)
    repo = await fixture
  })

  it('stages a tracked path with Git glob characters as one literal path', async ({ signal }) => {
    const operation = stageFile(repo, globNamedFile, { signal })
    pendingOperations.push(operation)
    await operation

    expect(gitNames(repo, ['diff', '--cached', '--name-only'])).toEqual([globNamedFile])
    expect(gitNames(repo, ['diff', '--name-only'])).toEqual([globMatchedFile])
  })

  it('bulk stages tracked paths with Git glob characters as literal paths', async ({ signal }) => {
    const operation = bulkStageFiles(repo, [globNamedFile], { signal })
    pendingOperations.push(operation)
    await operation

    expect(gitNames(repo, ['diff', '--cached', '--name-only'])).toEqual([globNamedFile])
    expect(gitNames(repo, ['diff', '--name-only'])).toEqual([globMatchedFile])
  })

  it('unstages a tracked path with Git glob characters as one literal path', async ({ signal }) => {
    execFileSync('git', ['add', gitLiteralPathspec(globNamedFile), globMatchedFile], {
      cwd: repo,
      windowsHide: true
    })

    const operation = unstageFile(repo, globNamedFile, { signal })
    pendingOperations.push(operation)
    await operation

    expect(gitNames(repo, ['diff', '--cached', '--name-only'])).toEqual([globMatchedFile])
    expect(gitNames(repo, ['diff', '--name-only'])).toEqual([globNamedFile])
  })

  it('bulk unstages tracked paths with Git glob characters as literal paths', async ({
    signal
  }) => {
    execFileSync('git', ['add', gitLiteralPathspec(globNamedFile), globMatchedFile], {
      cwd: repo,
      windowsHide: true
    })

    const operation = bulkUnstageFiles(repo, [globNamedFile], { signal })
    pendingOperations.push(operation)
    await operation

    expect(gitNames(repo, ['diff', '--cached', '--name-only'])).toEqual([globMatchedFile])
    expect(gitNames(repo, ['diff', '--name-only'])).toEqual([globNamedFile])
  })
})
