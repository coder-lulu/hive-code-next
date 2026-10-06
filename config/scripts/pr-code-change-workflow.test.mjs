import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
const projectDir = resolve(import.meta.dirname, '../..')
const prWorkflow = parse(readFileSync(join(projectDir, '.github/workflows/pr.yml'), 'utf8'))
const expensiveJobs = [
  'preflight',
  'git_compatibility',
  'codex_index_heal_contract',
  'xterm_patch_sync',
  'shell_contracts',
  'test',
  'orcad_browser',
  'cross-version-wire',
  'managed_hook_node18',
  'package',
  'package_windows'
]
const classifierJobs = [
  'static_analysis',
  'typecheck',
  ...expensiveJobs.filter((jobName) => jobName !== 'preflight')
]

describe('PR Checks skip wiring', () => {
  it('runs the candidate daemon shutdown Docker oracle in the existing Linux package job', () => {
    const steps = prWorkflow.jobs.package.steps
    const install = steps.findIndex(
      (step) => step.uses === './.github/actions/install-node-dependencies'
    )
    const oracle = steps.findIndex(
      (step) => step.name === 'Verify Linux daemon shutdown descendant cleanup'
    )
    expect(install).toBeGreaterThan(-1)
    expect(oracle).toBeGreaterThan(install)
    expect(steps[oracle].run).toBe('node config/scripts/run-daemon-shutdown-descendants-docker.mjs')
    expect(steps[oracle].env.ORCA_BACKGROUND_LAUNCH).toBe('1')
  })

  it('classifies the PR range with a tested script and expands renames', () => {
    const classify = prWorkflow.jobs.code_paths.steps.find(
      (step) => step.name === 'Classify changed paths'
    )
    expect(classify.run).toContain('--diff-filter=ACDMR')
    expect(classify.run).toContain('--no-renames')
    // HEAD is the merge commit, so HEAD^1 is the base side and no merge base is computed.
    // That is what lets this job check out shallowly, which every other job waits on.
    expect(classify.run).toContain('node config/scripts/git-pull-request-diff-base.mjs "$BASE_SHA"')
    expect(classify.run).toContain('"$DIFF_BASE" HEAD')
    expect(classify.run).not.toContain('--merge-base "$')
    expect(classify.run).toContain('node config/scripts/pr-code-change-scope.mjs')
    expect(classify.run).toContain('tee -a "$GITHUB_OUTPUT"')
    expect(prWorkflow.jobs.code_paths.outputs.should_run).toBe(
      '${{ steps.filter.outputs.should_run }}'
    )
    for (const jobName of classifierJobs) {
      expect(prWorkflow.jobs.code_paths.outputs[jobName], jobName).toBe(
        `\${{ steps.readiness.outputs.reused != 'true' && steps.filter.outputs.${jobName} }}`
      )
    }
    expect(prWorkflow.jobs.code_paths.outputs.native_cache_changed).toBeUndefined()
  })

  it('gives static analysis the mobile types its type-aware pass resolves', () => {
    expect(prWorkflow.jobs.code_paths.outputs.mobile_dependencies).toBe(
      '${{ steps.filter.outputs.mobile_dependencies }}'
    )
    const steps = prWorkflow.jobs.preflight.steps
    const install = steps.findIndex(
      (step) => step.uses === './.github/actions/install-mobile-dependencies'
    )
    const gate = steps.findIndex((step) => step.name === 'Enforce changed-code quality')
    expect(install).toBeGreaterThan(-1)
    expect(install).toBeLessThan(gate)
    expect(steps[install].if).toBe(
      "needs.code_paths.outputs.static_analysis == 'true' && needs.code_paths.outputs.mobile_dependencies == 'true'"
    )
    expect(steps[gate].env.PREFLIGHT_PHASE_SELECTED).toBe(
      "${{ needs.code_paths.outputs.static_analysis == 'true' }}"
    )
    expect(steps[gate].env.PREFLIGHT_PRIOR_SUCCESS).toBe("${{ job.status == 'success' }}")
    expect(steps[gate].run).toContain(
      'if [ "$PREFLIGHT_PHASE_SELECTED" != true ] || [ "$PREFLIGHT_PRIOR_SUCCESS" != true ]; then exit 0; fi'
    )
    // The install itself moved into the action the packaging jobs share; assert it there so
    // this job cannot keep the step while the action stops installing anything.
    const action = parse(
      readFileSync(
        join(projectDir, '.github/actions/install-mobile-dependencies/action.yml'),
        'utf8'
      )
    )
    const [installStep] = action.runs.steps
    expect(installStep['working-directory']).toBe('mobile')
    expect(installStep.run).toContain('--frozen-lockfile')
  })

  it('keeps the root and README guards on docs-only PRs without another runner', () => {
    const detector = prWorkflow.jobs.code_paths
    expect(detector.if).toBeUndefined()
    expect(detector.needs).toBeUndefined()
    for (const name of ['Reject new root-level files and folders', 'Check README local links']) {
      const step = detector.steps.find((candidate) => candidate.name === name)
      expect(step).toBeDefined()
      expect(step.if).toBeUndefined()
    }
    expect(prWorkflow.jobs.root_directory_guard).toBeUndefined()
  })

  it('gates each expensive job on its classifier and cache prerequisite', () => {
    for (const jobName of expensiveJobs.filter(
      (jobName) => jobName !== 'preflight' && jobName !== 'test'
    )) {
      expect(prWorkflow.jobs[jobName].needs, jobName).toEqual(['code_paths', 'preflight'])
      expect(prWorkflow.jobs[jobName].if, jobName).toBe(
        ['package', 'package_windows'].includes(jobName)
          ? `needs.code_paths.outputs.${jobName} == 'true'`
          : `!cancelled() && needs.code_paths.result == 'success' && needs.code_paths.outputs.${jobName} == 'true' && needs.preflight.result == 'success'`
      )
    }
    const preflight = prWorkflow.jobs.preflight
    expect(preflight.needs).toEqual(['code_paths'])
    expect(preflight.if).toBe(
      "needs.code_paths.outputs.static_analysis == 'true' || needs.code_paths.outputs.typecheck == 'true'"
    )
    expect(prWorkflow.jobs.test.needs).toEqual(['code_paths', 'preflight'])
    expect(prWorkflow.jobs.test.if).toContain('!cancelled()')
    expect(prWorkflow.jobs.test.if).toContain("needs.code_paths.outputs.test == 'true'")
    expect(prWorkflow.jobs.test.if).toContain("needs.preflight.result == 'success'")
    const steps = preflight.steps
    const plan = steps.findIndex((step) => step.name === 'Plan unit selection')
    const typecheck = steps.findIndex((step) => step.run === 'pnpm run typecheck')
    const wait = steps.findIndex((step) => step.wait === 'unit-plan')
    expect(plan).toBeGreaterThan(-1)
    expect(plan).toBeLessThan(typecheck)
    expect(wait).toBeGreaterThan(typecheck)
    expect(steps[plan].id).toBe('unit-plan')
    expect(steps[plan].if).toBe('!cancelled()')
    expect(steps[plan].background).toBe(true)
    expect(steps[plan].env.PREFLIGHT_PHASE_SELECTED).toBe(
      "${{ needs.code_paths.outputs.typecheck == 'true' }}"
    )
    expect(steps[plan].env.PREFLIGHT_PRIOR_SUCCESS).toBe("${{ job.status == 'success' }}")
    expect(steps[plan].run).toContain(
      'if [ "$PREFLIGHT_PHASE_SELECTED" != true ] || [ "$PREFLIGHT_PRIOR_SUCCESS" != true ]; then exit 0; fi'
    )
    expect(steps[plan].run).toContain('node config/scripts/ci-unit-plan.mjs')
    expect(preflight.outputs.shards).toBe('${{ steps.unit-plan.outputs.shards }}')
    expect(prWorkflow.jobs.test.with.shards).toBe('${{ needs.preflight.outputs.shards }}')
    for (const jobName of ['static_analysis', 'typecheck', 'unit_plan', 'test_native_cache']) {
      expect(prWorkflow.jobs[jobName], jobName).toBeUndefined()
    }
    expect(preflight.strategy).toBeUndefined()
    const primerInstalls = steps.filter(
      (step) => step.uses === './.github/actions/install-node-dependencies'
    )
    expect(primerInstalls).toHaveLength(2)
    expect(primerInstalls.map((step) => step.if)).toEqual([
      "needs.code_paths.outputs.mobile_dependencies != 'true'",
      "needs.code_paths.outputs.mobile_dependencies == 'true'"
    ])
    for (const install of primerInstalls) {
      expect(install.with['node-version']).toBe('24.18.0')
      expect(install.with['native-runtime']).toBe('node')
    }
  })

  it('skips e2e detection on docs-only PRs without dropping the draft gate', () => {
    const filter = prWorkflow.jobs.code_paths.steps.find((step) => step.id === 'e2e_filter')
    expect(filter.if).toBe(
      "github.event.pull_request.draft != true && steps.filter.outputs.should_run == 'true'"
    )
    expect(prWorkflow.jobs['e2e-paths']).toBeUndefined()
  })

  it('lets verify pass skipped jobs the classifier turned off', () => {
    const verifyStep = prWorkflow.jobs.verify.steps.find(
      (step) => step.name === 'Require successful checks'
    )
    expect(prWorkflow.jobs.verify.needs[0]).toBe('code_paths')
    expect(verifyStep.env.SHOULD_RUN).toBe('${{ needs.code_paths.outputs.should_run }}')
    expect(verifyStep.run).toContain('"$CODE_PATHS" != "success"')
    expect(verifyStep.run).toContain('# Require success when the PR has code-relevant changes')
    expect(verifyStep.run).toContain('expected skipped')
    expect(verifyStep.run).toContain('expected success')
    for (const job of prWorkflow.jobs.verify.needs) {
      if (job === 'code_paths') {
        continue
      }
      const envVar = `${job.replaceAll('-', '_').toUpperCase()}_SHOULD_RUN`
      expect(verifyStep.env[envVar]).toBe(
        job === 'preflight'
          ? "${{ needs.code_paths.outputs.static_analysis == 'true' || needs.code_paths.outputs.typecheck == 'true' }}"
          : `\${{ needs.code_paths.outputs.${job} }}`
      )
      expect(verifyStep.run).toContain(`"$${envVar}"`)
    }
  })
})
