import { spawnSync } from 'node:child_process'

/** Verify the actual Git/source state; record mode alone is never source provenance. */
export function assertRecordingSources(root: string, baseline: string, hive: boolean): void {
  if (!/^[a-f0-9]{40}$/.test(baseline)) {
    throw new Error('Recording requires one full source commit SHA')
  }
  function git(args: string[]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
    if (result.error) {
      throw result.error
    }
    return result
  }
  const commit = git(['cat-file', '-t', baseline])
  if (commit.status !== 0 || commit.stdout.trim() !== 'commit') {
    throw new Error('Recording baseline must name an existing commit')
  }
  const guardedSources = [
    'mobile/src',
    'src/shared',
    'mobile/pnpm-lock.yaml',
    ...(hive
      ? [
          'mobile/rpc-foundation/*.ts',
          'mobile/rpc-foundation/pilot-scenarios.json',
          'mobile/scripts/rpc-recording.mts'
        ]
      : [':!mobile/src/test-support/rpc-recording'])
  ]
  const diff = git(['diff', '--quiet', baseline, '--', ...guardedSources])
  if (diff.status !== 0 && diff.status !== 1) {
    throw new Error(`Could not diff pinned recording baseline ${baseline}: ${diff.stderr.trim()}`)
  }
  if (diff.status === 1) {
    throw new Error('Product sources differ from the pinned recording baseline')
  }
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...guardedSources])
  if (untracked.status !== 0 || untracked.stdout.trim()) {
    throw new Error(`Untracked product sources are not pinned by the baseline: ${untracked.stdout}`)
  }
}
