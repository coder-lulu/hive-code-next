import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * The release workflows build the native app without a selectable alternate shell.
 */
const projectDir = resolve(import.meta.dirname, '../..')
const SWITCH = 'EXPO_PUBLIC_MOBILE_SHELL'
const RELEASE_WORKFLOWS = {
  android: {
    file: 'mobile-android-release.yml',
    job: 'android-build',
    step: 'Build Android release APK',
    command: './gradlew assembleRelease'
  },
  ios: {
    file: 'mobile-ios-release.yml',
    job: 'ios-build',
    step: 'Build and upload to TestFlight',
    command: 'bundle exec fastlane ios build_and_upload'
  }
}

function workflowOf(file) {
  return parse(readFileSync(resolve(projectDir, '.github/workflows', file), 'utf8'))
}

function stepsOf(workflow) {
  return Object.entries(workflow.jobs).flatMap(([job, body]) =>
    (body.steps ?? []).map((step) => ({ job, step }))
  )
}

describe.each(Object.entries(RELEASE_WORKFLOWS))(
  'the %s release workflow',
  (_platform, { file, job, step: stepName, command }) => {
    const workflow = workflowOf(file)

    it('does not offer an alternate shell as a release input', () => {
      expect(workflow.on.workflow_dispatch.inputs).toBeDefined()
      expect(workflow.on.workflow_dispatch.inputs).not.toHaveProperty('shell')
    })

    it('keeps the native release build command in its platform job', () => {
      const builds = stepsOf(workflow).filter(({ step }) => step.name === stepName)
      expect(builds).toHaveLength(1)
      expect(builds[0].job).toBe(job)
      expect(builds[0].step.run).toContain(command)
    })

    it('does not override the native default at any workflow scope', () => {
      expect(readFileSync(resolve(projectDir, '.github/workflows', file), 'utf8')).not.toContain(
        SWITCH
      )
    })
  }
)

it('keeps shell overrides out of mobile CI and its composite actions', () => {
  const workflows = ['mobile.yml', 'pr.yml', 'mobile-android-release.yml', 'mobile-ios-release.yml']
  for (const file of workflows) {
    expect(readFileSync(resolve(projectDir, '.github/workflows', file), 'utf8')).not.toContain(
      SWITCH
    )
    expect(JSON.stringify(stepsIncludingComposites(file))).not.toContain(SWITCH)
  }
})

/**
 * The other half of the switch: what a restored bundler cache would do to it.
 *
 * `babel-preset-expo` inlines the variable at transform time, but nothing Metro hashes into the
 * transform cache key carries its value, so a Metro cache restored from a run of the opposite kind
 * returns the opposite shell byte for byte. `mobile/metro.config.js` folds the kind into
 * `cacheVersion` and so survives one; a cache keyed by these workflows would have to name the shell
 * too, and today none of them restores one at all.
 */
const MOBILE_WORKFLOWS = ['mobile.yml', 'mobile-android-release.yml', 'mobile-ios-release.yml']
/** Paths under which a Metro or Expo build cache lives, in the spellings a workflow would use. */
const BUNDLER_CACHE_PATHS = ['metro-cache', '.expo', 'node_modules/.cache']
/** Store/archive paths computed by scripts rather than declared in the workflows. */
const REVIEWED_COMPUTED_PATHS = [
  '${{ steps.electron-package-cache.outputs.cache-root }}',
  '${{ steps.pnpm-store.outputs.path }}',
  '${{ env.ORCA_PNPM_STORE_CACHE_PATH }}',
  // Only pnpm's lockfile-verified.jsonl record, never Metro transforms.
  '${{ steps.verification-cache.outputs.path }}',
  "${{ github.event_name != 'pull_request' && inputs.cache-pnpm-store != 'false' && steps.pnpm-store-mode.outputs.lookup-only != 'true' && 'pnpm' || '' }} store"
]

/** Every step a workflow runs, descending into the repository's own composite actions. */
function stepsIncludingComposites(file) {
  const collect = (owner, steps, into) => {
    for (const step of steps ?? []) {
      into.push({ owner, step })
      if (typeof step.uses === 'string' && step.uses.startsWith('./')) {
        const action = parse(readFileSync(resolve(projectDir, step.uses, 'action.yml'), 'utf8'))
        collect(step.uses, action.runs?.steps, into)
      }
    }
    return into
  }
  return Object.entries(workflowOf(file).jobs).flatMap(([job, body]) =>
    collect(job, body.steps, [])
  )
}

/** What those steps restore: `actions/cache`, and the setup actions that carry one of their own. */
function cacheRestores(file) {
  return stepsIncludingComposites(file).flatMap(({ owner, step }) => {
    const uses = typeof step.uses === 'string' ? step.uses : ''
    const named = { name: `${owner}: ${step.name ?? uses}` }
    if (/^actions\/cache(\/restore)?@/.test(uses)) {
      return [{ ...named, paths: String(step.with?.path ?? ''), key: String(step.with?.key ?? '') }]
    }
    if (uses.startsWith('actions/setup-node@') && step.with?.cache) {
      return [{ ...named, paths: `${step.with.cache} store`, key: '' }]
    }
    if (uses.startsWith('ruby/setup-ruby@') && step.with?.['bundler-cache']) {
      return [{ ...named, paths: 'bundler vendor', key: '' }]
    }
    return []
  })
}

const MOBILE_CACHE_RESTORES = MOBILE_WORKFLOWS.flatMap((file) => cacheRestores(file))

describe('what the mobile jobs restore from cache', () => {
  it('sees the caches these jobs already have, so the rule below cannot pass vacuously', () => {
    const names = MOBILE_CACHE_RESTORES.map(({ name }) => name)

    // One from a composite action and one declared in a workflow: a walk that stopped at either
    // boundary would report an empty list and call it clean.
    expect(names).toEqual(
      expect.arrayContaining([
        './.github/actions/install-node-dependencies: Cache Electron package archive',
        './.github/actions/prepare-native-runtime: Restore compiled native modules',
        './.github/actions/install-node-dependencies: Setup Node.js',
        'ios-build: Setup Ruby and fastlane'
      ])
    )
  })

  it('reads every restored path, rather than passing one it cannot evaluate', () => {
    const computed = MOBILE_CACHE_RESTORES.filter(({ paths }) => paths.includes('${{'))

    expect(computed.filter(({ paths }) => !REVIEWED_COMPUTED_PATHS.includes(paths))).toEqual([])
  })

  it('restores no Metro or Expo build cache, which would decide the shell before the env does', () => {
    const bundlerCaches = MOBILE_CACHE_RESTORES.filter(({ paths }) =>
      BUNDLER_CACHE_PATHS.some((needle) => paths.includes(needle))
    )

    // A restored one is not fatal — it just has to name the shell, the way `cacheVersion` does.
    expect(
      bundlerCaches.filter(({ key }) => !key.includes(SWITCH) && !key.includes('inputs.shell')),
      bundlerCaches.map(({ name, paths }) => `${name}: ${paths}`).join('\n')
    ).toEqual([])
    expect(bundlerCaches).toEqual([])
  })
})
