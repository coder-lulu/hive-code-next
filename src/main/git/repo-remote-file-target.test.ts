import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRemoteFileTarget } from './repo-remote-file-target'

const { runGit } = vi.hoisted(() => ({ runGit: vi.fn() }))
vi.mock('./runner', () => ({ gitExecFileAsync: runGit }))

const sha = 'a'.repeat(40)

function configureRemote(excluded = false) {
  runGit.mockImplementation(async (argv: string[]) => {
    let stdout = ''
    if (argv[0] === 'remote') {
      stdout = 'origin\tgit@github.com:owner/repository.git (fetch)\n'
    } else if (argv[0] === 'config') {
      stdout = 'remote.origin.fetch\n+refs/heads/*:refs/remotes/origin/*\0'
      if (excluded) {
        stdout += 'remote.origin.fetch\n^refs/heads/topic\0'
      }
    } else if (argv[0] === 'rev-parse') {
      stdout = sha
    } else if (argv[0] === 'symbolic-ref') {
      stdout = 'refs/heads/topic'
    } else if (argv.some((arg) => arg.startsWith('--contains='))) {
      stdout = 'refs/remotes/origin/topic\0\n'
    } else if (argv[0] === 'for-each-ref') {
      stdout =
        'refs/heads/topic\0\0origin\0refs/heads/topic\0refs/remotes/origin/topic\n' +
        'refs/remotes/origin/topic\0\0\0\0\n'
    }
    return { stdout, stderr: '' }
  })
}

describe('hosted remote file target authority', () => {
  beforeEach(() => {
    runGit.mockReset()
  })

  it('uses a published immutable revision and preserves WSL routing on every bounded probe', async () => {
    configureRemote()
    expect(await getRemoteFileTarget('/project', { wslDistro: 'Ubuntu' })).toEqual({
      remoteUrl: 'git@github.com:owner/repository.git',
      ref: sha
    })
    expect(runGit.mock.calls.length).toBeGreaterThan(4)
    for (const [, options] of runGit.mock.calls) {
      expect(options).toMatchObject({
        cwd: '/project',
        wslDistro: 'Ubuntu',
        maxBuffer: 1024 * 1024
      })
      expect(options.timeout).toBeGreaterThan(0)
      expect(options.timeout).toBeLessThanOrEqual(5000)
      expect(options.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('does not infer a published revision from an excluded tracking ref', async () => {
    configureRemote(true)
    expect(await getRemoteFileTarget('/project', {})).toEqual({
      remoteUrl: 'git@github.com:owner/repository.git',
      ref: 'topic'
    })
  })

  it('returns unavailable when the remote cannot be inspected', async () => {
    runGit.mockRejectedValue(new Error('remote unavailable'))
    expect(await getRemoteFileTarget('/project', { wslDistro: 'Ubuntu' })).toBeNull()
  })
})
