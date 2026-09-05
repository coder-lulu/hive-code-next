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
  'hourly-mac-build.yml',
  'daily-mac-build.yml',
  'adhoc-mac-build.yml',
  'dev-channel-win-build.yml',
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

function isUpstreamGuardedJob(jobs, jobName, visiting = new Set()) {
  const job = jobs[jobName]
  if (!job || visiting.has(jobName)) {
    return false
  }
  if (String(job.if ?? '').includes(upstreamRepositoryGuard)) {
    return true
  }
  const dependencies = typeof job.needs === 'string' ? [job.needs] : (job.needs ?? [])
  if (dependencies.length === 0) {
    return false
  }
  const next = new Set(visiting)
  next.add(jobName)
  return dependencies.every((dependency) => isUpstreamGuardedJob(jobs, dependency, next))
}

describe('HiveCloud product release workflow boundary', () => {
  it('uses only the approved HiveCloud beta feed and keeps retained upstream jobs unreachable', () => {
    expect(productManifest.desktop.updateRepository).toBeNull()
    expect(productManifest.desktop.updateProvider).toBe('hivecloud')
    expect(productManifest.endpoints.update).toBe(
      'https://updates.hive.test/hive/v1/updates/desktop/'
    )
    expect(productManifest.desktop.updateChannel).toBe('beta')

    for (const workflowName of retainedUpstreamReleaseWorkflows) {
      const workflow = parse(
        readFileSync(join(repoRoot, '.github/workflows', workflowName), 'utf8')
      )
      const jobs = workflow?.jobs ?? {}
      expect(Object.keys(jobs), `${workflowName} must contain at least one job`).not.toHaveLength(0)

      for (const jobName of Object.keys(jobs)) {
        expect(
          isUpstreamGuardedJob(jobs, jobName),
          `${workflowName}:${jobName} must be transitively hard-bound to the retained upstream repository`
        ).toBe(true)
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

  it('runs the HiveCloud Android publisher only in the HiveCode product repository', () => {
    const workflow = parse(
      readFileSync(join(repoRoot, '.github/workflows/mobile-android-release.yml'), 'utf8')
    )
    expect(workflow.jobs['android-build'].if).toContain(
      "github.repository == 'coder-lulu/hive-code-next'"
    )
    expect(workflow.jobs['android-build'].if).not.toContain(upstreamRepositoryGuard)
  })

  it('runs the manual HiveCloud macOS publisher only in the HiveCode product repository', () => {
    const workflow = parse(
      readFileSync(join(repoRoot, '.github/workflows/release-mac-build.yml'), 'utf8')
    )
    expect(workflow.jobs['build-mac'].if).toBe("github.repository == 'coder-lulu/hive-code-next'")
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
    const mergeStep = findStep(
      syncJob,
      (step) => step.run?.includes('git merge --no-edit'),
      'candidate must merge the pinned commits'
    )
    const mergeCommands = String(mergeStep.run)
      .split('\n')
      .filter((line) => line.includes('git merge --no-edit'))

    expect(workflow.on.workflow_dispatch.inputs.target_branch.default).toBe('hivecode/main-next')
    expect(workflow.env.TARGET_BRANCH).toContain("'hivecode/main-next'")
    expect(syncJob.outputs.target_sha).toBe('${{ steps.sync.outputs.target_sha }}')
    expect(syncScript).toContain('refs/heads/$TARGET_BRANCH:refs/remotes/origin/$TARGET_BRANCH')
    expect(syncScript).toContain('echo "target_sha=$target_sha"')
    expect(mergeStep.env.TARGET_SHA).toBe('${{ steps.sync.outputs.target_sha }}')
    expect(mergeStep.env.UPSTREAM_SHA).toBe('${{ steps.sync.outputs.upstream_sha }}')
    expect(mergeCommands).toHaveLength(2)
    expect(mergeCommands[0]).toContain('"$TARGET_SHA"')
    expect(mergeCommands[1]).toContain('--no-ff')
    expect(mergeCommands[1]).toContain('"$UPSTREAM_SHA"')

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
      (step) => step.id === 'proposal',
      'proposal step must validate synchronization SHAs'
    )
    const proposeScript = String(proposeStep.run)

    expect(workflow.jobs.propose.env.TARGET_SHA).toBe('${{ needs.sync.outputs.target_sha }}')
    expect(workflow.jobs.propose.env.VENDOR_SHA).toBe('${{ needs.sync.outputs.vendor_sha }}')
    for (const [branch, sha] of [
      ['VENDOR_BRANCH', 'VENDOR_SHA'],
      ['TARGET_BRANCH', 'TARGET_SHA']
    ]) {
      const remoteCheck = `test "$(git ls-remote origin "refs/heads/$${branch}" | cut -f1)" = "$${sha}"`
      const fetchedCheck = `test "$(git rev-parse "refs/remotes/origin/$${branch}")" = "$${sha}"`
      expect(proposeScript).toContain(remoteCheck)
      expect(proposeScript).toContain(fetchedCheck)
      expect(proposeScript.indexOf(fetchedCheck)).toBeLessThan(
        proposeScript.indexOf('node config/scripts/upstream-sync-pr.mjs')
      )
      expect(workflow.jobs.propose.steps.at(-1).run).toContain(remoteCheck)
    }
  })
})
