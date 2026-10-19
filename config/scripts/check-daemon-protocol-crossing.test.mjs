import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkDaemonProtocolCrossing } from './check-daemon-protocol-crossing.mjs'
import { DAEMON_PROTOCOL_SOURCE_PATH } from './daemon-protocol-facts.mjs'
import { selectLatestStableReleaseTag } from './stable-release-tags.mjs'
import * as upstreamPins from './prepare-cross-version-baselines.mjs'

const repos = []
const logs = resolve(import.meta.dirname, '../../logs/daemon-protocol-crossing')

function git(repo, args) {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
}

function writeProtocol(repo, current) {
  const previous = Array.from({ length: current - 1 }, (_, index) => index + 1)
  const file = join(repo, DAEMON_PROTOCOL_SOURCE_PATH)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(
    file,
    `export const PROTOCOL_VERSION = ${current}\nexport const PREVIOUS_DAEMON_PROTOCOL_VERSIONS = [${previous.join(', ')}] as const\n`
  )
}

function repoWithTags(tagged) {
  mkdirSync(logs, { recursive: true })
  const repo = mkdtempSync(join(logs, 'test-'))
  repos.push(repo)
  git(repo, ['init', '-q'])
  for (const [tag, protocol] of tagged) {
    writeProtocol(repo, protocol)
    git(repo, ['add', '.'])
    git(repo, [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-q',
      '--no-gpg-sign',
      '-m',
      tag
    ])
    git(repo, ['tag', tag])
  }
  return repo
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const repo of repos.splice(0)) {
    rmSync(repo, { recursive: true, force: true })
  }
})

describe('selectLatestStableReleaseTag', () => {
  it('orders numerically and skips prerelease tags', () => {
    expect(selectLatestStableReleaseTag(['v1.4.9', 'v1.4.10', 'v1.5.0-rc.1', 'nightly'])).toBe(
      'v1.4.10'
    )
    expect(selectLatestStableReleaseTag(['nightly'])).toBeNull()
  })
})

describe('checkDaemonProtocolCrossing', () => {
  const env = {}

  it('passes a bump that lists the newest release version, reporting rollback as info', () => {
    const repo = repoWithTags([
      ['v1.0.9', 5],
      ['v1.0.10', 6]
    ])
    writeProtocol(repo, 7)
    const result = checkDaemonProtocolCrossing({ repoRoot: repo, env })
    expect(result).toMatchObject({ upgrade: true, rollback: false })
    expect(result.lines[0]).toBe('release v1.0.10: daemon protocol 6')
  })

  it('fails when the working tree drops the newest release version', () => {
    const repo = repoWithTags([['v1.0.0', 6]])
    writeFileSync(
      join(repo, DAEMON_PROTOCOL_SOURCE_PATH),
      'export const PROTOCOL_VERSION = 7\nexport const PREVIOUS_DAEMON_PROTOCOL_VERSIONS = [1, 2, 3, 4, 5] as const\n'
    )
    const result = checkDaemonProtocolCrossing({ repoRoot: repo, env })
    expect(result.upgrade).toBe(false)
    expect(result.lines.join('\n')).toContain('add 6 to PREVIOUS_DAEMON_PROTOCOL_VERSIONS')
  })

  it('refuses to pass silently without release tags', () => {
    const repo = repoWithTags([['nightly', 6]])
    expect(() => checkDaemonProtocolCrossing({ repoRoot: repo, env })).toThrow(
      /no stable release tags/
    )
  })

  it('honors an explicit release ref', () => {
    const repo = repoWithTags([
      ['v1.0.0', 5],
      ['v1.0.1', 6]
    ])
    const result = checkDaemonProtocolCrossing({ repoRoot: repo, releaseRef: 'v1.0.0', env })
    expect(result).toMatchObject({ upgrade: true, rollback: false })
    expect(result.lines[0]).toBe('release v1.0.0: daemon protocol 5')
  })

  it('reads the prepared pinned object when its release tag is absent', () => {
    const repo = repoWithTags([['nightly', 6]])
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8'
    }).trim()
    const pin = vi.spyOn(upstreamPins, 'resolvePinnedUpstreamRef').mockReturnValue(commit)
    const result = checkDaemonProtocolCrossing({
      repoRoot: repo,
      env: { ORCA_CROSS_VERSION_BASELINE_REF: 'v1.4.186' }
    })
    expect(pin).toHaveBeenCalledWith('v1.4.186')
    expect(result).toMatchObject({ upgrade: true, rollback: true })
  })
})
