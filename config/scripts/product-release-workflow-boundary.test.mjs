import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..')
const productManifest = JSON.parse(
  readFileSync(join(repoRoot, 'config/product/hivecode.product.json'), 'utf8')
)
const retainedUpstreamReleaseWorkflows = [
  'release-cut.yml',
  'release-mac-build.yml',
  'hourly-mac-build.yml',
  'adhoc-mac-build.yml',
  'mobile-android-release.yml',
  'mobile-ios-release.yml'
]
const upstreamRepositoryGuard = "github.repository == 'stablyai/orca'"
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const packagingScripts = [
  'build:desktop',
  'build:release',
  'build:unpack',
  'build:win',
  'build:mac',
  'build:linux',
  'build:mac:release'
]

const findStep = (job, predicate, description) => {
  const step = job?.steps?.find(predicate)
  expect(step, description).toBeDefined()
  return step
}

describe('disabled product release workflow boundary', () => {
  it('keeps every retained upstream release job unreachable in the product repository', () => {
    expect(productManifest.desktop.updateRepository).toBeNull()
    expect(productManifest.endpoints.update).toBeNull()
    expect(productManifest.desktop.updateChannel).toBeNull()

    for (const workflowName of retainedUpstreamReleaseWorkflows) {
      const workflow = parse(
        readFileSync(join(repoRoot, '.github/workflows', workflowName), 'utf8')
      )
      const jobs = workflow?.jobs ?? {}
      expect(Object.keys(jobs), `${workflowName} must contain at least one job`).not.toHaveLength(0)

      for (const [jobName, job] of Object.entries(jobs)) {
        expect(
          String(job?.if ?? ''),
          `${workflowName}:${jobName} must be hard-bound to the retained upstream repository while product updates are disabled`
        ).toContain(upstreamRepositoryGuard)
      }
    }
  })

  it('verifies generated product configuration before every packaging entry point', () => {
    for (const scriptName of packagingScripts) {
      expect(
        packageJson.scripts?.[scriptName],
        `${scriptName} must verify generated product configuration before packaging`
      ).toContain('verify:product-config')
    }
  })
})

describe('upstream synchronization boundary', () => {
  it('tests a vendor commit that contains the pinned product target before upstream', () => {
    const workflow = parse(
      readFileSync(join(repoRoot, '.github/workflows/upstream-sync.yml'), 'utf8')
    )
    const syncJob = workflow.jobs.sync
    const syncStep = findStep(syncJob, (step) => step.id === 'sync', 'sync step must exist')
    const syncScript = String(syncStep.run)
    const mergeTarget = 'git merge --no-edit "$target_ref"'
    const mergeUpstream = 'git merge --no-edit --no-ff "upstream/$UPSTREAM_BRANCH"'

    expect(workflow.on.workflow_dispatch.inputs.target_branch.default).toBe('hivecode/main-next')
    expect(workflow.env.TARGET_BRANCH).toContain("'hivecode/main-next'")
    expect(syncJob.outputs.target_sha).toBe('${{ steps.sync.outputs.target_sha }}')
    expect(syncScript).toContain('refs/heads/$TARGET_BRANCH:$target_ref')
    expect(syncScript).toContain('echo "target_sha=$target_sha"')
    expect(syncScript.indexOf(mergeTarget)).toBeGreaterThan(-1)
    expect(syncScript.indexOf(mergeUpstream)).toBeGreaterThan(syncScript.indexOf(mergeTarget))

    const checkoutStep = findStep(
      workflow.jobs.gates,
      (step) => step.uses === 'actions/checkout@v6',
      'gates checkout must exist'
    )
    expect(checkoutStep.with.ref).toBe('${{ needs.sync.outputs.vendor_sha }}')
  })

  it('refuses a proposal when the tested vendor or product target has moved', () => {
    const workflow = parse(
      readFileSync(join(repoRoot, '.github/workflows/upstream-sync.yml'), 'utf8')
    )
    const proposeStep = findStep(
      workflow.jobs.propose,
      (step) => step.env?.VENDOR_SHA,
      'proposal step must pin synchronization SHAs'
    )
    const proposeScript = String(proposeStep.run)

    expect(proposeStep.env.TARGET_SHA).toBe('${{ needs.sync.outputs.target_sha }}')
    expect(proposeScript).toContain('vendor_remote_sha')
    expect(proposeScript).toContain('target_remote_sha')
    expect(proposeScript).toContain('target_remote_sha" != "$TARGET_SHA')
  })
})
