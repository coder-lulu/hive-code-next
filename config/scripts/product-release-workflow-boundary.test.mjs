import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..')
const productManifest = JSON.parse(
  readFileSync(join(repoRoot, 'config/product/hivecode.product.json'), 'utf8')
)
const retainedUpstreamReleaseWorkflows = [
  'cloud-push-deploy.yml',
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

const trustedTreeSync = '"$RUNNER_TEMP/upstream-sync-control/config/scripts/upstream-tree-sync.mjs"'

function expectFrozenTreeSyncInvocation(step, command, owner = trustedTreeSync) {
  const script = String(step.run)
  const invocations = script
    .replace(/\\\r?\n\s*/g, ' ')
    .split('\n')
    .filter((line) => line.trim().startsWith('node ') && line.includes('upstream-tree-sync.mjs'))
  expect(step.shell).toBe('bash')
  expect(script).not.toContain('set +e')
  expect(invocations).toHaveLength(1)
  expect(invocations[0]).not.toMatch(/[|;&]/)
  expect(invocations[0].trim()).toMatch(
    new RegExp(`^node ${owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${command} `)
  )
  for (const input of [
    '--cwd "$GITHUB_WORKSPACE"',
    '--target "$TARGET_SHA"',
    '--upstream "$UPSTREAM_SHA"',
    '--target-branch "$TARGET_BRANCH"',
    '--report '
  ]) {
    expect(invocations[0]).toContain(input)
  }
  if (command === 'verify') {
    expect(invocations[0]).toContain('--head "$CANDIDATE_SHA"')
  }
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
      'https://releases.hivekernel.com/hive/v1/updates/desktop/'
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
      const command = packageJson.scripts?.[scriptName]
      if (command?.startsWith('pnpm run clients:build -- --target ')) {
        expect(packageJson.scripts['clients:build']).toContain(
          'config/scripts/client-build.mjs build'
        )
        const owner = readFileSync(
          join(repoRoot, 'config/scripts/client-build-desktop.mjs'),
          'utf8'
        )
        const compile = owner.indexOf("['run', 'build:desktop']")
        expect(compile).toBeGreaterThan(-1)
        expect(owner.indexOf("'desktop-package'")).toBeGreaterThan(compile)
        expect(packageJson.scripts['build:desktop']).toMatch(/^pnpm run verify:product-config &&/)
      } else {
        expect(command, `${scriptName} must verify product configuration`).toContain(
          'verify:product-config'
        )
      }
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
  it('tests the upstream candidate based directly on the pinned product target', () => {
    const workflow = parse(
      readFileSync(join(repoRoot, '.github/workflows/upstream-sync.yml'), 'utf8')
    )
    const syncJob = workflow.jobs.sync
    const syncStep = findStep(syncJob, (step) => step.id === 'sync', 'sync step must exist')
    const syncScript = String(syncStep.run)
    const prepareStep = findStep(
      syncJob,
      (step) => step.run?.includes('upstream-tree-sync.mjs" prepare'),
      'candidate must prepare content from the frozen product and upstream inputs'
    )
    const prepareScript = String(prepareStep.run)

    expect(workflow.on.workflow_dispatch.inputs.target_branch.default).toBe('hivecode/main-next')
    expect(workflow.env.TARGET_BRANCH).toContain("'hivecode/main-next'")
    expect(syncJob.outputs.target_sha).toBe('${{ steps.sync.outputs.target_sha }}')
    expect(syncJob.outputs.node_version).toBe('${{ steps.sync.outputs.node_version }}')
    expect(syncStep.env.GH_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}')
    expect(syncScript.indexOf('gh auth setup-git --hostname github.com')).toBeLessThan(
      syncScript.indexOf('git fetch --no-tags --prune origin')
    )
    expect(syncScript).toContain('refs/heads/$TARGET_BRANCH:refs/remotes/origin/$TARGET_BRANCH')
    expect(syncScript).toContain('echo "target_sha=$target_sha"')
    expect(syncScript).toContain("jq -er '.engines.node")
    expect(syncScript).toContain('echo "node_version=$node_version"')
    expect(syncScript).toContain('git archive "$target_sha" config package.json')
    const syncNodeSetup = findStep(
      syncJob,
      (step) => step.uses === 'actions/setup-node@v6',
      'sync Node.js setup must exist'
    )
    expect(syncNodeSetup.with['node-version']).toBe('${{ steps.sync.outputs.node_version }}')
    expect(syncNodeSetup.with['node-version-file']).toBeUndefined()
    expect(prepareStep.env.TARGET_SHA).toBe('${{ steps.sync.outputs.target_sha }}')
    expect(prepareStep.env.UPSTREAM_SHA).toBe('${{ steps.sync.outputs.upstream_sha }}')
    expectFrozenTreeSyncInvocation(prepareStep, 'prepare')
    const pinnedCheckout = 'git switch --force-create "$TARGET_BRANCH" "$TARGET_SHA"'
    expect(prepareScript).toContain(pinnedCheckout)
    expect(prepareScript).toContain('if ! git diff --cached --quiet; then')
    expect(prepareScript).toContain('git commit -m ')
    expect(prepareScript).not.toMatch(/(?:^|\n)\s*git merge(?:\s|$)/)
    expect(prepareScript).not.toContain('--no-ff')
    expect(prepareScript.indexOf(pinnedCheckout)).toBeLessThan(
      prepareScript.indexOf(trustedTreeSync)
    )
    expect(prepareScript.indexOf(trustedTreeSync)).toBeLessThan(
      prepareScript.indexOf('git commit -m ')
    )
    expect(syncJob.steps.indexOf(syncNodeSetup)).toBeLessThan(syncJob.steps.indexOf(prepareStep))
    const checkpointIndex = syncJob.steps.findIndex((step) =>
      step.run?.includes('--write-checkpoint')
    )
    expect(checkpointIndex).toBeGreaterThan(syncJob.steps.indexOf(prepareStep))

    const checkoutStep = findStep(
      workflow.jobs.gates,
      (step) => step.uses === 'actions/checkout@v6',
      'gates checkout must exist'
    )
    expect(checkoutStep.with.ref).toBe('${{ needs.sync.outputs.target_sha }}')
    const gatesNodeSetup = findStep(
      workflow.jobs.gates,
      (step) => step.uses === 'actions/setup-node@v6',
      'gates Node.js setup must exist'
    )
    expect(gatesNodeSetup.with['node-version']).toBe('${{ needs.sync.outputs.node_version }}')
    expect(gatesNodeSetup.with['node-version-file']).toBeUndefined()
  })

  it('recomputes the receipted single-parent content proof from frozen control before every execution and publication', () => {
    const workflow = parse(
      readFileSync(join(repoRoot, '.github/workflows/upstream-sync.yml'), 'utf8')
    )
    for (const name of ['gates', 'platform-gates']) {
      const job = workflow.jobs[name]
      const load = findStep(
        job,
        (step) => step.run?.includes('git bundle verify'),
        `${name} must load the exact candidate`
      )
      expect(load.run).toContain('git merge-base --is-ancestor "$TARGET_SHA" "$CANDIDATE_SHA"')
      expect(load.run).toContain(
        'fetch --no-tags "https://github.com/$UPSTREAM_REPOSITORY.git" "$UPSTREAM_SHA"'
      )
      expect(load.run).toContain('test "$(git rev-parse FETCH_HEAD)" = "$UPSTREAM_SHA"')
      const control = findStep(
        job,
        (step) => step.run?.includes('git archive "$TARGET_SHA" config package.json'),
        `${name} must archive frozen control`
      )
      const proofSteps = job.steps.filter((step) =>
        step.run?.includes('upstream-tree-sync.mjs" verify')
      )
      expect(proofSteps.length).toBeGreaterThan(0)
      for (const proof of proofSteps) {
        expectFrozenTreeSyncInvocation(proof, 'verify')
        expect(job.steps.indexOf(control)).toBeLessThan(job.steps.indexOf(proof))
      }
      const execution = job.steps.findIndex(
        (step) => step.uses === './.github/actions/install-node-dependencies'
      )
      expect(execution).toBeGreaterThan(job.steps.indexOf(proofSteps[0]))
    }
    const publish = workflow.jobs.publish
    const validation = findStep(
      publish,
      (step) => step.run?.includes('upstream-sync-publication.mjs'),
      'publisher must validate frozen evidence'
    )
    expectFrozenTreeSyncInvocation(validation, 'verify', 'config/scripts/upstream-tree-sync.mjs')
    expect(validation.run).toContain('test "$(git rev-parse HEAD)" = "$TARGET_SHA"')
    expect(validation.run).toContain('git merge-base --is-ancestor "$TARGET_SHA" "$CANDIDATE_SHA"')
    expect(validation.run.indexOf('upstream-tree-sync.mjs verify')).toBeLessThan(
      validation.run.indexOf('upstream-sync-publication.mjs')
    )
    expect(
      publish.steps.some((step) => step.run?.includes('checkout --detach "$CANDIDATE_SHA"'))
    ).toBe(false)
  })

  it.each([
    ['target', '--target "$TARGET_SHA"', '--target HEAD'],
    ['upstream', '--upstream "$UPSTREAM_SHA"', '--upstream upstream/main'],
    ['candidate', '--head "$CANDIDATE_SHA"', '--head HEAD'],
    ['control', trustedTreeSync, 'config/scripts/upstream-tree-sync.mjs'],
    ['failure propagation', null, ' || true']
  ])('rejects a weakened %s in the gate content proof', (_name, original, replacement) => {
    const workflow = parse(
      readFileSync(join(repoRoot, '.github/workflows/upstream-sync.yml'), 'utf8')
    )
    const step = findStep(
      workflow.jobs.gates,
      (item) => item.run?.includes('upstream-tree-sync.mjs" verify'),
      'gate proof must exist'
    )
    const run =
      original === null
        ? `${step.run.trimEnd()}${replacement}\n`
        : step.run.replace(original, replacement)
    expect(run).not.toBe(step.run)
    expect(() => expectFrozenTreeSyncInvocation({ ...step, run }, 'verify')).toThrow()
  })

  it('separates candidate execution from publication credentials and rejects remote movement', () => {
    const workflow = parse(
      readFileSync(join(repoRoot, '.github/workflows/upstream-sync.yml'), 'utf8')
    )
    for (const name of ['sync', 'gates', 'platform-gates']) {
      expect(workflow.jobs[name].permissions).toEqual({ contents: 'read' })
      expect(workflow.jobs[name].steps.some((step) => step.run?.includes('git push '))).toBe(false)
    }
    const publish = workflow.jobs.publish
    expect(publish.needs).toEqual(['sync', 'gates', 'platform-gates'])
    expect(publish.if).toContain("needs.gates.result == 'success'")
    expect(publish.if).toContain("needs.platform-gates.result == 'success'")
    expect(publish.permissions).toEqual({ contents: 'write' })
    const checkout = publish.steps.find((step) => step.uses === 'actions/checkout@v6')
    expect(checkout.with.ref).toBe('${{ needs.sync.outputs.target_sha }}')
    expect(checkout.with['persist-credentials']).toBe(false)
    const validation = publish.steps.find((step) =>
      step.run?.includes('upstream-sync-publication.mjs')
    )
    expect(validation.env.GH_TOKEN).toBeUndefined()
    expect(validation.run).toContain('git merge-base --is-ancestor "$TARGET_SHA" "$CANDIDATE_SHA"')
    expect(validation.run).toContain('test "$(git rev-parse FETCH_HEAD)" = "$CANDIDATE_SHA"')
    const push = publish.steps.at(-1)
    expect(push.env.GH_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}')
    expect(push.run).toContain(
      'test "$(git ls-remote origin "refs/heads/$TARGET_BRANCH" | cut -f1)" = "$TARGET_SHA"'
    )
    expect(push.run).toContain('push origin "$CANDIDATE_SHA:refs/heads/$TARGET_BRANCH"')
    expect(push.run).not.toContain('--force')
    expect(push.run).not.toContain('node ')
    expect(push.run).not.toContain('pnpm ')
    const checkpoint = workflow.jobs.sync.steps.findIndex((step) =>
      step.run?.includes('--write-checkpoint')
    )
    const bundle = workflow.jobs.sync.steps.findIndex((step) =>
      step.run?.includes('git bundle create')
    )
    expect(bundle).toBeGreaterThan(checkpoint)
    expect(workflow.jobs.sync.steps[checkpoint].run).toContain('--require-boundary-review')
    expect(workflow.jobs.sync.steps[checkpoint].run).toContain(
      'if [ "$(git rev-parse HEAD)" = "$TARGET_SHA" ]'
    )
    for (const name of ['gates', 'platform-gates']) {
      const load = workflow.jobs[name].steps.find((step) => step.run?.includes('git bundle verify'))
      expect(load.run).toContain('test "$(git rev-parse FETCH_HEAD)" = "$CANDIDATE_SHA"')
      expect(load.run).toContain('checkout --detach "$CANDIDATE_SHA"')
    }
  })
})
