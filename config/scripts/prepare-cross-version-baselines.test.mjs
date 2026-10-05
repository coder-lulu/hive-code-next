import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const owner = path
  .resolve(import.meta.dirname, 'prepare-cross-version-baselines.mjs')
  .replaceAll('\\', '/')
const load = () => import(/* @vite-ignore */ owner)

describe('immutable upstream compatibility baseline acquisition', () => {
  it('preserves the reviewed stable and browser placement releases as their real upstream commits', async () => {
    const { BASELINE_RELEASE, resolvePinnedUpstreamRef } = await load()
    expect(BASELINE_RELEASE).toBe('v1.4.186')
    expect(resolvePinnedUpstreamRef('v1.4.186')).toBe('d802fdc7429f5f9d959b99a73656545bd760eace')
    expect(resolvePinnedUpstreamRef('v1.4.184')).toBe('2307f2ebbe1c1e737c0b12d920bb0a208332db2c')
    expect(resolvePinnedUpstreamRef('4cb013c0a9')).toBe('4cb013c0a9251275fa3d20ea33b45429e07aa6be')
    expect(resolvePinnedUpstreamRef('HEAD')).toBe('HEAD')
  })
  it('resolves published labels through the active checkout owner without a local tag', async () => {
    const { resolveReleaseCheckoutCommit } =
      await import('../../tests/e2e/cross-version-wire/release-checkout.ts')
    const commit = '2307f2ebbe1c1e737c0b12d920bb0a208332db2c'
    expect(
      resolveReleaseCheckoutCommit('v1.4.184', (args) => {
        expect(args).toEqual(['rev-parse', `${commit}^{commit}`])
        return `${commit}\n`
      })
    ).toBe(commit)
    expect(() => resolveReleaseCheckoutCommit('v1.4.184', () => 'f'.repeat(40))).toThrow(
      'Pinned upstream release resolved to a different commit'
    )
  })
  it.each([
    ['v1.4.205', '11aba8bdc5e492d3ba01fc7fe333495ace74128f'],
    ['v1.4.211', '5534462b50c660888487a2108700d4cf284270db'],
    ['v1.4.214', '7468e9cccb35a8494f76dc95a37627121113ee80'],
    ['v1.4.218', '75ea50273328d9bd5465170d10a098711d61b5a4'],
    ['3727100cc9dbcea6201f8a3e506676a3c4b53b18', '3727100cc9dbcea6201f8a3e506676a3c4b53b18'],
    ['aac38d698ff75ac4c8658addab48ef5a83617619', 'aac38d698ff75ac4c8658addab48ef5a83617619'],
    ['b49abdb1f4da6b3d62dfa9ccf3c74dc9e74d291c', 'b49abdb1f4da6b3d62dfa9ccf3c74dc9e74d291c'],
    ['f97ca2a49d9c711dab54a656a7f8a47ae6c6749c', 'f97ca2a49d9c711dab54a656a7f8a47ae6c6749c']
  ])('includes incoming baseline %s in exact-object preparation', async (ref, commit) => {
    const { UPSTREAM_BASELINE_PINS, resolvePinnedUpstreamRef } = await load()
    expect(resolvePinnedUpstreamRef(ref)).toBe(commit)
    expect(Object.values(UPSTREAM_BASELINE_PINS)).toContain(commit)
    const { resolveReleaseCheckoutCommit } =
      await import('../../tests/e2e/cross-version-wire/release-checkout.ts')
    expect(
      resolveReleaseCheckoutCommit(ref, (args) => {
        expect(args).toEqual(['rev-parse', `${commit}^{commit}`])
        return `${commit}\n`
      })
    ).toBe(commit)
  })
  it('fetches only missing immutable objects from the exact upstream without tags or ref updates', async () => {
    const { prepareCrossVersionBaselines, UPSTREAM_BASELINE_PINS } = await load()
    const missing = new Set(Object.values(UPSTREAM_BASELINE_PINS))
    const calls = []
    const git = (args) => {
      calls.push(args)
      if (args[0] === 'fetch') {
        for (const sha of args.slice(6)) {
          missing.delete(sha)
        }
        return ''
      }
      const sha = args.at(-1).replace(/\^\{commit\}$/, '')
      if (missing.has(sha)) {
        throw Object.assign(new Error('Missing object'), { status: 128 })
      }
      return `${sha}\n`
    }
    const proof = prepareCrossVersionBaselines({ git })
    const fetches = calls.filter((args) => args[0] === 'fetch')
    expect(fetches).toHaveLength(1)
    expect(fetches[0].slice(0, 6)).toEqual([
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-write-fetch-head',
      '--depth=1',
      'https://github.com/stablyai/orca.git'
    ])
    expect(fetches[0].slice(6)).toEqual([...new Set(Object.values(UPSTREAM_BASELINE_PINS))])
    expect(fetches[0].every((arg) => !arg.startsWith('refs/') && !arg.includes(':refs/'))).toBe(
      true
    )
    expect(proof).toMatchObject({
      upstream: 'stablyai/orca',
      baselineRelease: 'v1.4.186',
      baselineCommit: 'd802fdc7429f5f9d959b99a73656545bd760eace'
    })
  })
  it('reuses existing objects while still verifying every exact commit identity', async () => {
    const { prepareCrossVersionBaselines, UPSTREAM_BASELINE_PINS } = await load()
    const calls = []
    const git = (args) => {
      calls.push(args)
      return args.at(-1).replace(/\^\{commit\}$/, '')
    }
    const proof = prepareCrossVersionBaselines({ git })
    expect(calls.every((args) => args[0] === 'rev-parse')).toBe(true)
    expect(proof.commits).toHaveLength(new Set(Object.values(UPSTREAM_BASELINE_PINS)).size)
  })
  it('fails closed for fetch failure, unresolved objects or mismatched identities', async () => {
    const { prepareCrossVersionBaselines } = await load()
    const missing = () => {
      throw Object.assign(new Error('Object unavailable'), { status: 128 })
    }
    expect(() => prepareCrossVersionBaselines({ git: missing })).toThrow('Object unavailable')
    let fetched = false
    const stillMissing = (args) => {
      if (args[0] === 'fetch') {
        fetched = true
        return ''
      }
      return missing()
    }
    expect(() => prepareCrossVersionBaselines({ git: stillMissing })).toThrow()
    expect(fetched).toBe(true)
    expect(() => prepareCrossVersionBaselines({ git: () => 'f'.repeat(40) })).toThrow(
      'Upstream baseline identity mismatch'
    )
    expect(() =>
      prepareCrossVersionBaselines({
        git: () => {
          throw Object.assign(new Error('Git unavailable'), { status: 127 })
        }
      })
    ).toThrow('Git unavailable')
  })
  it('makes PR baseline preparation mandatory before unchanged real compatibility journeys', async () => {
    const { BASELINE_RELEASE } = await load()
    const workflow = parse(
      readFileSync(new URL('../../.github/workflows/pr.yml', import.meta.url), 'utf8')
    )
    const job = workflow.jobs['cross-version-wire']
    const prepare = job.steps.find(
      (step) => step.name === 'Prepare immutable upstream compatibility baselines'
    )
    const test = job.steps.find(
      (step) => step.name === 'Old/new client and server compatibility journeys'
    )
    expect(prepare?.run).toBe('node config/scripts/prepare-cross-version-baselines.mjs')
    expect(prepare?.if).toBeUndefined()
    expect(prepare?.['continue-on-error']).toBeUndefined()
    expect(job.steps.indexOf(prepare)).toBeLessThan(job.steps.indexOf(test))
    expect(job.env.ORCA_CROSS_VERSION_BASELINE_REF).toBe(BASELINE_RELEASE)
    expect(test.run).toBe(
      'pnpm exec vitest run --config config/vitest.config.ts tests/e2e/cross-version-wire/'
    )
    for (const owner of [
      'cross-version-browser-placement.unit.test.ts',
      'reported-lossy-initial-snapshot.unit.test.ts'
    ]) {
      expect(
        existsSync(new URL(`../../tests/e2e/cross-version-wire/${owner}`, import.meta.url))
      ).toBe(true)
    }
  })
})
