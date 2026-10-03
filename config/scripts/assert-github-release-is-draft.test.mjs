import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import {
  matchingDesktopReleases,
  restorePublishedDesktopReleasesToDraft
} from './assert-github-release-is-draft.mjs'

const require = createRequire(import.meta.url)
const repoRoot = join(import.meta.dirname, '../..')

function jsonResponse(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body))
  }
}

describe('matchingDesktopReleases', () => {
  it('matches tagged, untagged-name, and version-name releases', () => {
    const releases = [
      { id: 1, tag_name: 'v1.4.206', name: 'v1.4.206', draft: true },
      { id: 2, tag_name: 'untagged-abc', name: '1.4.206', draft: false },
      { id: 3, tag_name: 'v1.4.205', name: 'v1.4.205', draft: false }
    ]

    expect(matchingDesktopReleases(releases, 'v1.4.206').map((release) => release.id)).toEqual([
      1, 2
    ])
  })
})

describe('restorePublishedDesktopReleasesToDraft', () => {
  it('leaves drafts alone', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([{ id: 1, tag_name: 'v1.4.206', name: 'v1.4.206', draft: true }])
      )

    await expect(
      restorePublishedDesktopReleasesToDraft({
        repo: 'stablyai/orca',
        tag: 'v1.4.206',
        token: 'token',
        fetchImpl,
        log: vi.fn()
      })
    ).resolves.toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('re-drafts a published match immediately', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([{ id: 9, tag_name: 'v1.4.206', name: '1.4.206', draft: false }])
      )
      .mockResolvedValueOnce(jsonResponse({ id: 9, tag_name: 'v1.4.206', draft: true }))

    const log = vi.fn()
    await expect(
      restorePublishedDesktopReleasesToDraft({
        repo: 'stablyai/orca',
        tag: 'v1.4.206',
        token: 'token',
        fetchImpl,
        log
      })
    ).resolves.toEqual([{ id: 9, tag_name: 'v1.4.206', draft: true }])

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/stablyai/orca/releases/9',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ draft: true, make_latest: 'false' })
      })
    )
    expect(log).toHaveBeenCalledWith('Restored GitHub release 9 (v1.4.206) to draft.')
  })

  it('fails closed when no matching release exists', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse([]))

    await expect(
      restorePublishedDesktopReleasesToDraft({
        repo: 'stablyai/orca',
        tag: 'v1.4.206',
        token: 'token',
        fetchImpl
      })
    ).rejects.toThrow('No GitHub release named v1.4.206 was found after artifact upload')
  })
})

describe('release publication boundary', () => {
  it('keeps Hive artifact publishing explicit and disables implicit GitHub uploads', () => {
    const releaseWorkflow = parse(
      readFileSync(join(repoRoot, '.github/workflows/release-cut.yml'), 'utf8')
    )
    const macWorkflow = parse(
      readFileSync(join(repoRoot, '.github/workflows/release-mac-build.yml'), 'utf8')
    )
    const electronBuilderConfig = require('../electron-builder.config.cjs')
    const cutCheckout = releaseWorkflow.jobs.cut.steps.find((step) => step.name === 'Checkout ref')
    const macSteps = macWorkflow.jobs['build-mac'].steps
    const macBuildStep = macSteps.find((step) => step.name === 'Build release artifacts (macOS)')
    const macPublishStep = macSteps.find(
      (step) => step.name === 'Publish macOS ZIP artifacts to HiveCloud object storage'
    )
    const linuxPublishStep = releaseWorkflow.jobs.build.steps.find(
      (step) => step.name === 'Publish Linux AppImage to HiveCloud object storage'
    )
    const windowsPublishStep = releaseWorkflow.jobs.build.steps.find(
      (step) => step.name === 'Publish signed Windows installer to HiveCloud object storage'
    )

    expect(electronBuilderConfig.publish).toBeNull()
    expect(cutCheckout.with['fetch-tags']).toBe(true)
    for (const entry of releaseWorkflow.jobs.build.strategy.matrix.include) {
      expect(entry.release_command).toContain('--publish never')
    }
    expect(macBuildStep.with.command).toContain('--publish never')
    expect(linuxPublishStep.run).toContain('publish-hivecloud-desktop-release.mjs')
    expect(windowsPublishStep.with.command).toContain('publish-hivecloud-desktop-release.mjs')
    expect(macPublishStep.run).toContain('publish-hivecloud-desktop-release.mjs')
    expect(releaseWorkflow.jobs['publish-release'].if).toContain("github.repository == 'stablyai/orca'")
  })
})
