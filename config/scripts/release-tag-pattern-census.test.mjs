// Census: every release-triggered workflow and every script that lists this repo's releases
// classifies tags through shared patterns or real rejection proofs, so the agent state
// rules cannot reach a desktop-only path through one that forgot it.
import { readdirSync, readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import {
  DESKTOP_RC_TAG,
  DESKTOP_STABLE_TAG,
  DESKTOP_STABLE_TAG_SHELL_PATTERN,
  agentStateRulesTag,
  isAgentStateRulesTag
} from './release-tag-patterns.mjs'

const WORKFLOWS_DIR = '.github/workflows'
const SCRIPT_DIRS = ['config/scripts', '.github/scripts']
const SHARED_IMPORT = /from '[^']*release-tag-patterns\.mjs'/
const LISTS_RELEASES = /\/releases\?|listReleases|releases\.atom|'release',\s*'list'/

const RULES_TAGS = [agentStateRulesTag(1, 'next'), agentStateRulesTag(1, 'stable')]
const rulesRelease = (tag, extra = {}) => ({
  tag_name: tag,
  name: tag,
  draft: false,
  prerelease: true,
  author: { login: 'github-actions[bot]' },
  assets: [{ name: 'agent-state-rules.json', download_count: 5 }],
  ...extra
})

function read(path) {
  return readFileSync(path, 'utf8')
}

function importsSharedPatterns(path) {
  return SHARED_IMPORT.test(read(path))
}

function isReleaseTriggered(workflow) {
  const on = workflow.on
  if (typeof on === 'string') {
    return on === 'release'
  }
  if (Array.isArray(on)) {
    return on.includes('release')
  }
  return typeof on === 'object' && on !== null && 'release' in on
}

function releaseTriggeredWorkflows() {
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => posix.join(WORKFLOWS_DIR, name))
    .filter((path) => isReleaseTriggered(parse(read(path))))
}

function scriptsNamedIn(text) {
  return [...text.matchAll(/((?:config|\.github)\/scripts\/[\w.-]+\.mjs)/g)].map(
    (match) => match[1]
  )
}

function releaseListingScripts() {
  return SCRIPT_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.mjs') && !name.includes('.test.'))
      .map((name) => posix.join(dir, name))
  ).filter((path) => LISTS_RELEASES.test(read(path)))
}

/**
 * Scripts that list releases yet admit only desktop tags by their own shape. Each entry proves,
 * by calling the script, that a rules release never passes; a new listing script must import the
 * shared patterns or add a proof here.
 */
const DESKTOP_ONLY_PROOFS = {
  'config/scripts/publish-hivecloud-desktop-release.mjs': async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const tag of RULES_TAGS) {
      for (const [name, value] of Object.entries({
        HIVECLOUD_API_URL: 'https://releases.example.test',
        HIVECLOUD_API_TOKEN: 'test-token',
        HIVECODE_VERSION: tag,
        HIVECODE_DESKTOP_PLATFORM: 'windows',
        HIVECODE_DESKTOP_ARCHITECTURE: 'x64',
        HIVECODE_RELEASE_CHANNEL: 'stable',
        HIVECODE_SIGNING_CERTIFICATE_FINGERPRINT: '',
        HIVECLOUD_RELEASE_ATTESTATION_KEY: Buffer.alloc(32, 7).toString('base64')
      })) {
        vi.stubEnv(name, value)
      }
      vi.resetModules()
      const { main } = await import('./publish-hivecloud-desktop-release.mjs')
      await expect(main()).rejects.toThrow('HIVECODE_VERSION is not a supported SemVer value')
      expect(fetch).not.toHaveBeenCalled()
    }
  },
  'config/scripts/create-draft-release.mjs': async () => {
    const { latestPreviousPublishedDesktopReleaseTag } = await import('./create-draft-release.mjs')
    const releases = [
      ...RULES_TAGS.map((tag) => rulesRelease(tag)),
      { tag_name: 'v1.4.1', draft: false }
    ]
    expect(latestPreviousPublishedDesktopReleaseTag(releases, 'v1.4.2')).toBe('v1.4.1')
  },
  'config/scripts/publish-complete-draft-releases.mjs': async () => {
    const { isReleaseCutDraft } = await import('./publish-complete-draft-releases.mjs')
    for (const tag of RULES_TAGS) {
      expect(isReleaseCutDraft(rulesRelease(tag, { draft: true }))).toBe(false)
    }
  },
  'config/scripts/latest-stable-release.mjs': async () => {
    const { latestStableDesktopReleaseTag } = await import('./latest-stable-release.mjs')
    const releases = [
      ...RULES_TAGS.map((tag) => rulesRelease(tag, { prerelease: false })),
      { tag_name: 'v1.4.1' }
    ]
    expect(latestStableDesktopReleaseTag(releases)).toBe('v1.4.1')
  },
  'config/scripts/assert-github-release-is-draft.mjs': async () => {
    const { matchingDesktopReleases } = await import('./assert-github-release-is-draft.mjs')
    expect(
      matchingDesktopReleases(
        RULES_TAGS.map((tag) => rulesRelease(tag)),
        'v1.4.1'
      )
    ).toEqual([])
  },
  'config/scripts/verify-release-required-assets.mjs': async () => {
    const { verifyRequiredReleaseAssets } = await import('./verify-release-required-assets.mjs')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(RULES_TAGS.map((tag) => rulesRelease(tag)))))
    )
    await expect(
      verifyRequiredReleaseAssets({ repo: 'stablyai/orca', tag: 'v1.4.1', token: '' })
    ).rejects.toThrow('was not found')
  }
}

const RELEASE_WORKFLOW_PROOFS = {
  '.github/workflows/release-policy.yml': async () => {
    const workflow = parse(read('.github/workflows/release-policy.yml'))
    const script = workflow.jobs.enforce.steps.find(
      (step) => step.name === 'Enforce release policy'
    ).with.script
    const execute = new (Object.getPrototypeOf(async () => {}).constructor)(
      'github',
      'context',
      'core',
      script
    )
    for (const tag of RULES_TAGS) {
      for (const author of ['github-actions[bot]', 'maintainer']) {
        for (const action of ['published', 'edited']) {
          const release = rulesRelease(tag, {
            id: 8,
            prerelease: false,
            author: { login: author }
          })
          const github = {
            paginate: vi.fn(async () => [release]),
            rest: {
              repos: {
                listReleases: vi.fn(),
                updateRelease: vi.fn(async () => ({})),
                deleteRelease: vi.fn(async () => ({}))
              },
              git: { deleteRef: vi.fn(async () => ({})) }
            }
          }
          const core = { warning: vi.fn() }
          await execute(
            github,
            {
              repo: { owner: 'fixture-owner', repo: 'fixture-repo' },
              payload: { action, release }
            },
            core
          )
          if (action === 'published') {
            expect(github.rest.repos.updateRelease).toHaveBeenCalledExactlyOnceWith({
              owner: 'fixture-owner',
              repo: 'fixture-repo',
              release_id: 8,
              draft: true,
              prerelease: true,
              make_latest: 'false'
            })
            expect(github.rest.repos.deleteRelease).toHaveBeenCalledExactlyOnceWith({
              owner: 'fixture-owner',
              repo: 'fixture-repo',
              release_id: 8
            })
            expect(github.rest.git.deleteRef).toHaveBeenCalledExactlyOnceWith({
              owner: 'fixture-owner',
              repo: 'fixture-repo',
              ref: `tags/${tag}`
            })
          } else {
            expect(github.rest.repos.updateRelease).not.toHaveBeenCalled()
            expect(github.rest.repos.deleteRelease).not.toHaveBeenCalled()
            expect(github.rest.git.deleteRef).not.toHaveBeenCalled()
            expect(github.paginate).not.toHaveBeenCalled()
            expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('left as-is'))
          }
        }
      }
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('release tag pattern census', () => {
  it('finds the release-triggered workflows and release-listing scripts it guards', () => {
    const workflows = releaseTriggeredWorkflows()
    expect(workflows.length).toBeGreaterThan(0)
    expect(releaseListingScripts().length).toBeGreaterThan(0)
    expect(
      Object.keys(RELEASE_WORKFLOW_PROOFS).filter((path) => !workflows.includes(path))
    ).toEqual([])
  })

  it.each(releaseTriggeredWorkflows())(
    '%s classifies tags through the shared patterns',
    async (path) => {
      const text = read(path)
      const viaScript = scriptsNamedIn(text).some(importsSharedPatterns)
      const viaShellPattern = text.includes(DESKTOP_STABLE_TAG_SHELL_PATTERN)
      const proof = RELEASE_WORKFLOW_PROOFS[path]
      if (!viaScript && !viaShellPattern && proof) {
        await proof()
        return
      }
      expect(
        viaScript || viaShellPattern,
        `${path} names no script importing release-tag-patterns.mjs and embeds no shared pattern`
      ).toBe(true)
    }
  )

  it.each(releaseTriggeredWorkflows())(
    '%s checks out the shared patterns beside its script',
    (path) => {
      const workflow = parse(read(path))
      const sparse = Object.values(workflow.jobs)
        .flatMap((job) => job.steps ?? [])
        .map((step) => step.with?.['sparse-checkout'])
        .filter((value) => typeof value === 'string')
      for (const paths of sparse) {
        if (scriptsNamedIn(paths).some(importsSharedPatterns)) {
          expect(paths).toContain('config/scripts/release-tag-patterns.mjs')
        }
      }
    }
  )

  it.each(releaseListingScripts())(
    '%s imports the shared patterns or proves it admits only desktop tags',
    async (path) => {
      if (importsSharedPatterns(path)) {
        return
      }
      const proof = DESKTOP_ONLY_PROOFS[path]
      expect(
        proof,
        `${path} lists releases: import release-tag-patterns.mjs or add a proof`
      ).toBeDefined()
      await proof()
    }
  )

  it('keeps no proof for a script that no longer lists releases', () => {
    const listing = new Set(releaseListingScripts())
    expect(Object.keys(DESKTOP_ONLY_PROOFS).filter((path) => !listing.has(path))).toEqual([])
  })

  it('never classifies an agent state rules tag as a desktop release', () => {
    for (const tag of RULES_TAGS) {
      expect(isAgentStateRulesTag(tag)).toBe(true)
      expect(DESKTOP_STABLE_TAG.test(tag) || DESKTOP_RC_TAG.test(tag)).toBe(false)
    }
    expect(() => agentStateRulesTag(1, 'beta')).toThrow()
  })
})
