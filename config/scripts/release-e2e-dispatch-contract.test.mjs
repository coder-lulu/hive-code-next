import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const releaseWorkflow = parse(
  readFileSync(join(projectDir, '.github/workflows/release-cut.yml'), 'utf8')
)
const e2eWorkflow = parse(readFileSync(join(projectDir, '.github/workflows/e2e.yml'), 'utf8'))

describe('release E2E dispatch contract', () => {
  it('validates immutable tags with the current golden test harness', () => {
    const restoreStep = releaseWorkflow.jobs['terminal-rendering-golden'].steps.find(
      (step) => step.name === 'Restore golden test harness from the workflow ref'
    )

    expect(restoreStep.env.WORKFLOW_SHA).toBe('${{ github.workflow_sha }}')
    expect(restoreStep.run).toContain('git fetch --no-tags --depth=1 origin "$WORKFLOW_SHA"')
    expect(restoreStep.run).toContain('golden-source-control-open-diff.spec.ts')
    expect(restoreStep.run).toContain('golden-terminal-file-link.spec.ts')
    expect(restoreStep.run).toContain('golden-worktree-create-switch.spec.ts')
  })

  it('dispatches tag-scoped E2E only after publication', () => {
    const dispatchJob = releaseWorkflow.jobs['post-release-e2e']
    const dispatchStep = dispatchJob.steps.find((step) => step.name === 'Dispatch tag-scoped E2E')

    expect(releaseWorkflow.jobs.e2e).toBeUndefined()
    expect(dispatchJob.needs).toEqual(['cut', 'publish-release'])
    expect(dispatchJob.if).toBe(
      "${{ github.repository == 'stablyai/orca' && !cancelled() && needs.publish-release.result == 'success' && needs.cut.outputs.tag != '' }}"
    )
    expect(dispatchJob.permissions.actions).toBe('write')
    expect(dispatchStep.env.TAG).toBe('${{ needs.cut.outputs.tag }}')
    expect(dispatchStep.run).toContain('gh workflow run e2e.yml')
    expect(dispatchStep.run).toContain('--ref "$TAG"')
    expect(dispatchStep.run).toContain('--raw-field "ref=refs/tags/$TAG"')
    expect(dispatchStep.run).toContain('for attempt in 1 2 3')
    expect(dispatchStep.run).toContain('[[ "$attempt" -eq 3 ]] || sleep')
    expect(dispatchStep.run).toContain('::warning::Failed to dispatch post-release E2E')
  })

  it('keeps detached E2E identifiable and manually dispatchable by ref', () => {
    const refInput = e2eWorkflow.on.workflow_dispatch.inputs.ref

    expect(e2eWorkflow['run-name']).toBe('E2E ${{ inputs.ref || github.ref }}')
    expect(refInput.type).toBe('string')
    expect(refInput.required).toBe(false)
  })

  it('builds current Electron output without a retired relay bundle', () => {
    const buildStep = e2eWorkflow.jobs.build.steps.find((step) => step.name === 'Build E2E outputs')

    expect(buildStep.run).toBe('pnpm run build:electron-vite:parallel --mode e2e')
    expect(buildStep.run).not.toContain('build:relay')
  })

  it('primes the Electron native cache before every E2E consumer', () => {
    const steps = e2eWorkflow.jobs.build.steps
    const joinedBuild = steps.findIndex((step) => step.wait === 'e2e-cli')
    const upload = steps.findIndex((step) => step.id === 'e2e-build-upload')
    const native = steps.findIndex((step) => step.id === 'electron-native-runtime')
    const fallback = steps.findIndex(
      (step) => step.name === 'Prepare Electron natives for older refs'
    )
    const joinedUpload = steps.findIndex((step) => step.wait === 'e2e-build-upload')
    expect(joinedBuild).toBeGreaterThanOrEqual(0)
    expect(upload).toBeGreaterThan(joinedBuild)
    expect(steps[upload].background).toBe(true)
    expect(native).toBeGreaterThan(upload)
    expect(steps[native].uses).toBe('./.github/actions/prepare-native-runtime')
    expect(steps[native].with).toEqual({
      'native-runtime': 'electron',
      'node-version': '${{ steps.deps.outputs.node-version }}'
    })
    expect(steps[native].if).toBe(
      "steps.native-runtime-action.outputs.available == 'true' && steps.deps.outputs.node-version != ''"
    )
    expect(fallback).toBeGreaterThan(native)
    expect(steps[fallback].uses).toBe('./.github/actions/install-node-dependencies')
    expect(steps[fallback].with).toEqual({ 'native-runtime': 'electron' })
    expect(steps[fallback].if).toBe(
      "steps.native-runtime-action.outputs.available != 'true' || steps.deps.outputs.node-version == ''"
    )
    expect(joinedUpload).toBeGreaterThan(fallback)
    expect(joinedUpload).toBe(steps.length - 1)
    for (const step of [steps[native], steps[fallback], steps[joinedUpload]]) {
      expect(step.background).toBeUndefined()
      expect(step['continue-on-error']).toBeUndefined()
    }
    for (const jobName of ['e2e', 'changed-e2e', 'orcad-serve-mode-switch', 'orcad-ssh-docker']) {
      const consumer = e2eWorkflow.jobs[jobName]
      expect(consumer.needs, jobName).toEqual(['build'])
      expect(
        consumer.steps.find((step) => step.uses === './.github/actions/install-node-dependencies')
          .with['native-runtime']
      ).toBe('electron')
    }
  })

  it('includes the paired-runtime web client in the shared E2E build artifact', () => {
    const buildStep = e2eWorkflow.jobs.build.steps.find((step) => step.name === 'Build E2E outputs')

    expect(buildStep.run).toContain('pnpm run build:electron-vite:parallel --mode e2e')
    expect(buildStep.env.VITE_EXPOSE_STORE).toBe('true')
    expect(
      e2eWorkflow.jobs.build.steps.find((step) => step.name === 'Project shared E2E web client').run
    ).toBe('pnpm run build:web-from-renderer')
  })

  it('joins the shared CLI and web builds before uploading complete E2E output', () => {
    const steps = e2eWorkflow.jobs.build.steps
    const electron = steps.findIndex((step) => step.name === 'Build E2E outputs')
    const cli = steps.findIndex((step) => step.id === 'e2e-cli')
    const web = steps.findIndex((step) => step.name === 'Project shared E2E web client')
    const join = steps.findIndex((step) => step.wait === 'e2e-cli')
    const upload = steps.findIndex((step) => step.name === 'Upload E2E build output')
    expect(cli).toBeGreaterThan(electron)
    expect(steps[cli].background).toBe(true)
    expect(steps[cli].run).toContain('pnpm run build:cli')
    expect(steps[cli].run).toContain('scripts["prepare:cli-output"]')
    expect(web).toBeGreaterThan(cli)
    expect(steps[web].run).toBe('pnpm run build:web-from-renderer')
    expect(join).toBeGreaterThan(web)
    expect(upload).toBeGreaterThan(join)
    expect(steps[upload].with.path).toBe('out/')
  })

  it('hands the isolated current build artifact to every E2E run command', () => {
    const uploadStep = e2eWorkflow.jobs.build.steps.find(
      (step) => step.name === 'Upload E2E build output'
    )

    expect(uploadStep.with.name).toBe('e2e-build-out${{ inputs.artifact_suffix }}')
    expect(uploadStep.with.path).toBe('out/')

    for (const [jobName, runStepName] of [
      ['e2e', 'Run E2E tests (${{ matrix.shard_name }})'],
      ['changed-e2e', 'Run changed E2E specs']
    ]) {
      const job = e2eWorkflow.jobs[jobName]
      const downloadStep = job.steps.find((step) => step.name === 'Download E2E build output')
      const runStep = job.steps.find((step) => step.name === runStepName)

      expect(job.needs).toEqual(['build'])
      expect(downloadStep.with.name).toBe('e2e-build-out${{ inputs.artifact_suffix }}')
      expect(downloadStep.with.path).toBe('out/')
      expect(runStep.run).toContain('SKIP_BUILD=1')
      expect(runStep.run).toContain('ORCA_E2E_WEB_CLIENT=1')
      expect(runStep.run).not.toContain('ORCA_RELAY_PATH')
    }
  })
})
