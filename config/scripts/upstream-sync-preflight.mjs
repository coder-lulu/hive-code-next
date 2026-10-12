import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  createGit,
  PRODUCT_TARGET_BRANCHES,
  resolveCommit,
  SHA_PATTERN
} from './upstream-sync-checkpoint.mjs'

export function verifyFrozenProductTip({
  cwd = process.cwd(),
  target,
  targetBranch = 'hivecode/main-next',
  remote = 'origin',
  git = createGit(cwd, {
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
    timeoutMs: 60_000,
    maxBuffer: 1024 * 1024
  })
}) {
  if (!SHA_PATTERN.test(target ?? '') || !PRODUCT_TARGET_BRANCHES.includes(targetBranch)) {
    throw new Error('Preflight requires a frozen product SHA and a supported product branch')
  }
  if (typeof remote !== 'string' || !remote || remote.startsWith('-') || /\s|\0/.test(remote)) {
    throw new Error('Preflight requires a safe remote name or URL')
  }
  if (resolveCommit(git, target) !== target) {
    throw new Error('Frozen product commit is unavailable')
  }
  const ref = `refs/heads/${targetBranch}`
  const rows = git(['ls-remote', '--exit-code', '--refs', remote, ref]).trim().split(/\r?\n/)
  const [remoteTarget, remoteRef, extra] = (rows[0] ?? '').split(/\s+/)
  if (rows.length !== 1 || !SHA_PATTERN.test(remoteTarget ?? '') || remoteRef !== ref || extra) {
    throw new Error('Product remote did not return one exact branch tip')
  }
  if (remoteTarget !== target) {
    throw new Error(
      `Product main moved from ${target} to ${remoteTarget}; refresh the candidate before expensive verification`
    )
  }
  return {
    check: 'frozen-product-tip',
    targetBranch,
    targetSha: target,
    passed: true,
    formalAcceptance: false
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const { values } = parseArgs({
      options: {
        cwd: { type: 'string' },
        target: { type: 'string' },
        'target-branch': { type: 'string' },
        remote: { type: 'string' }
      }
    })
    console.log(
      JSON.stringify(verifyFrozenProductTip({ ...values, targetBranch: values['target-branch'] }))
    )
  } catch (error) {
    console.error(`[upstream-sync] ${error.message}`)
    process.exitCode = 1
  }
}
