import path from 'node:path'
import { createGit } from './upstream-sync-checkpoint.mjs'

export const BASELINE_RELEASE = 'v1.4.186'
const UPSTREAM_URL = 'https://github.com/stablyai/orca.git'
// Published release labels resolve to verified upstream objects without creating local tags.
export const UPSTREAM_BASELINE_PINS = Object.freeze({
  'v1.4.186': 'd802fdc7429f5f9d959b99a73656545bd760eace',
  'v1.4.184': '2307f2ebbe1c1e737c0b12d920bb0a208332db2c',
  'v1.4.205': '11aba8bdc5e492d3ba01fc7fe333495ace74128f',
  'v1.4.211': '5534462b50c660888487a2108700d4cf284270db',
  'v1.4.214': '7468e9cccb35a8494f76dc95a37627121113ee80',
  'v1.4.218': '75ea50273328d9bd5465170d10a098711d61b5a4',
  'v1.4.219': 'e705cac04a1db7e7e2184746e912142d34ca838b',
  'v1.4.220': 'a7927b28ce45cbb044add478d957abe36c99ccd8',
  'v1.4.221': '9dd8812384db85d0b4ede2d1e37f9d73bdb4ea8c',
  '5a56636f6679071d6ec68b851ef7932cd3222560': '5a56636f6679071d6ec68b851ef7932cd3222560',
  e817b0e23747ffd6f16f2ddefea861950d82a3c0: 'e817b0e23747ffd6f16f2ddefea861950d82a3c0',
  '3727100cc9dbcea6201f8a3e506676a3c4b53b18': '3727100cc9dbcea6201f8a3e506676a3c4b53b18',
  aac38d698ff75ac4c8658addab48ef5a83617619: 'aac38d698ff75ac4c8658addab48ef5a83617619',
  b49abdb1f4da6b3d62dfa9ccf3c74dc9e74d291c: 'b49abdb1f4da6b3d62dfa9ccf3c74dc9e74d291c',
  f97ca2a49d9c711dab54a656a7f8a47ae6c6749c: 'f97ca2a49d9c711dab54a656a7f8a47ae6c6749c',
  '5534462b50c660888487a2108700d4cf284270db': '5534462b50c660888487a2108700d4cf284270db',
  '28957d6004dd191b6f0baff493a9fd3d37405d9d': '28957d6004dd191b6f0baff493a9fd3d37405d9d',
  '6e4f817101daa18d82824b69243d9079baa9c416': '6e4f817101daa18d82824b69243d9079baa9c416',
  d937d22f498505c017634be9bf0540c9fa42e665: 'd937d22f498505c017634be9bf0540c9fa42e665',
  '4cb013c0a9': '4cb013c0a9251275fa3d20ea33b45429e07aa6be',
  '4bb337741c': '4bb337741c335cfcc428d3b4271023566e2dadb8',
  fd9125ea8c: 'fd9125ea8c7b347cd8b675a4095e31cd3c865d25'
})

export function resolvePinnedUpstreamRef(ref) {
  return Object.hasOwn(UPSTREAM_BASELINE_PINS, ref) ? UPSTREAM_BASELINE_PINS[ref] : ref
}

function createBaselineGit(cwd) {
  const env = { ...process.env }
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
    delete env[name]
  }
  return createGit(cwd, { env, timeoutMs: 300_000, maxBuffer: 16 * 1024 * 1024 })
}

export function prepareCrossVersionBaselines({
  cwd = process.cwd(),
  git = createBaselineGit(cwd)
} = {}) {
  const commits = [...new Set(Object.values(UPSTREAM_BASELINE_PINS))]
  const verify = (sha) => {
    const resolved = git(['rev-parse', '--verify', '--end-of-options', `${sha}^{commit}`]).trim()
    if (resolved !== sha) {
      throw new Error(`Upstream baseline identity mismatch: ${sha}`)
    }
  }
  const missing = commits.filter((sha) => {
    try {
      verify(sha)
      return false
    } catch (error) {
      if (error.status !== 128) {
        throw error
      }
      return true
    }
  })
  if (missing.length) {
    // Fetch full snapshot blobs so archives do not depend on an implicit promisor remote.
    git([
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-write-fetch-head',
      '--depth=1',
      UPSTREAM_URL,
      ...missing
    ])
  }
  for (const sha of commits) {
    verify(sha)
  }
  return {
    schemaVersion: 1,
    upstream: 'stablyai/orca',
    baselineRelease: BASELINE_RELEASE,
    baselineCommit: UPSTREAM_BASELINE_PINS[BASELINE_RELEASE],
    commits
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    console.log(JSON.stringify(prepareCrossVersionBaselines(), null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
