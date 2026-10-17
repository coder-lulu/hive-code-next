import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const readProject = (file) => readFileSync(join(projectDir, file), 'utf8')

describe('Electron runtime package contract', () => {
  it('pins the Windows release builder to the VS 2022 runner image', () => {
    const releaseWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const windowsReleaseEntry = releaseWorkflow.jobs.build.strategy.matrix.include.find(
      ({ platform }) => platform === 'win'
    )

    expect(windowsReleaseEntry.os).toBe('windows-2022')
  })

  it('keeps release-cut signing provenance on GitHub-hosted runners', () => {
    const releaseWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const buildMatrixRunners = releaseWorkflow.jobs.build.strategy.matrix.include.map(
      ({ os }) => os
    )
    const releaseWorkflowText = readProject('.github/workflows/release-cut.yml')
    const macDispatchStep = releaseWorkflow.jobs['build-mac'].steps.find(
      (step) => step.name === 'Run isolated macOS release build'
    )

    expect(releaseWorkflowText).not.toContain('blacksmith-')
    expect(releaseWorkflow.jobs['build-mac']['runs-on']).toBe('ubuntu-latest')
    expect(releaseWorkflow.jobs['build-mac'].permissions.actions).toBe('write')
    expect(macDispatchStep.run).toBe(
      'node config/scripts/run-release-mac-build-workflow.mjs dispatch'
    )
    expect(macDispatchStep.env.RELEASE_MAC_BUILD_WORKFLOW).toBe('release-mac-build.yml')
    expect(macDispatchStep.env.RELEASE_MAC_BUILD_TAG).toBe('${{ needs.cut.outputs.tag }}')
    expect(buildMatrixRunners).not.toContain('blacksmith-6vcpu-macos-15')
    expect(releaseWorkflow.jobs['publish-release'].needs).toContain('build')
    expect(releaseWorkflow.jobs['publish-release'].needs).toContain('build-mac')
    expect(releaseWorkflow.jobs['publish-release'].needs).toContain('verify-mac-build')
    const macVerification = releaseWorkflow.jobs['verify-mac-build']
    expect(macVerification.needs).toEqual(['cut', 'build-mac', 'build'])
    expect(macVerification.if).toContain('!cancelled()')
    expect(macVerification.if).not.toContain('needs.build.result')
    expect(macVerification.permissions).toEqual({ actions: 'read', contents: 'read' })
    expect(releaseWorkflow.jobs['publish-release'].if).toContain(
      "needs.verify-mac-build.result == 'success'"
    )
  })

  it('qualifies macOS after failed sibling builds and publishes only complete successful builds', () => {
    const { jobs } = parse(readProject('.github/workflows/release-cut.yml'))
    const evaluate = (source, needs, cancelled, repository = 'stablyai/orca') =>
      runInNewContext(source.replace(/needs\.([a-z][a-z0-9-]*)/g, 'needs["$1"]'), {
        needs,
        github: { repository },
        cancelled: () => cancelled
      })
    const results = ['success', 'failure', 'skipped', 'cancelled']
    for (const matrix of results) {
      for (const dispatch of results) {
        for (const verification of results) {
          for (const cancelled of [false, true]) {
            const needs = {
              cut: { result: 'success', outputs: { should_release: 'true' } },
              build: { result: matrix },
              'build-mac': { result: dispatch },
              'verify-mac-build': { result: verification },
              'skill-sharing-linux-floor-release-gate': { result: 'success' },
              'skill-sharing-release-gate': { result: 'success' },
              'terminal-rendering-golden': { result: 'success' }
            }
            expect(evaluate(jobs['verify-mac-build'].if, needs, cancelled)).toBe(
              !cancelled && dispatch === 'success'
            )
            expect(
              evaluate(jobs['publish-release'].if, needs, cancelled, 'coder-lulu/hive-code-next')
            ).toBe(false)
            expect(evaluate(jobs['publish-release'].if, needs, cancelled)).toBe(
              !cancelled &&
                matrix === 'success' &&
                dispatch === 'success' &&
                verification === 'success'
            )
          }
        }
      }
    }
    for (const prerequisite of [
      'cut',
      'skill-sharing-linux-floor-release-gate',
      'skill-sharing-release-gate',
      'terminal-rendering-golden'
    ]) {
      const needs = Object.fromEntries([
        ['cut', { result: 'success', outputs: { should_release: 'true' } }],
        ...[
          'build',
          'build-mac',
          'verify-mac-build',
          'skill-sharing-linux-floor-release-gate',
          'skill-sharing-release-gate',
          'terminal-rendering-golden'
        ].map((name) => [name, { result: 'success' }])
      ])
      needs[prerequisite].result = 'failure'
      expect(evaluate(jobs['publish-release'].if, needs, false)).toBe(false)
    }
  })

  it('runs the macOS release build in an isolated Blacksmith workflow', () => {
    const releaseMacWorkflowText = readProject('.github/workflows/release-mac-build.yml')
    const releaseMacWorkflow = parse(releaseMacWorkflowText)
    const buildMacJob = releaseMacWorkflow.jobs['build-mac']
    const checkoutStep = buildMacJob.steps.find((step) => step.name === 'Checkout')
    const publishStep = buildMacJob.steps.find(
      (step) => step.name === 'Build release artifacts (macOS)'
    )

    expect(releaseMacWorkflow['run-name']).toBe(
      'Mac release build ${{ inputs.tag }} (${{ inputs.release_run_id }})'
    )
    expect(releaseMacWorkflow.on.workflow_dispatch.inputs.tag.required).toBe(true)
    expect(releaseMacWorkflow.on.workflow_dispatch.inputs.release_run_id.required).toBe(true)
    expect(buildMacJob['runs-on']).toBe('blacksmith-6vcpu-macos-15')
    expect(checkoutStep.with.ref).toBe('refs/tags/${{ inputs.tag }}')
    expect(publishStep.with.command).toContain('ORCA_MAC_RELEASE=1')
    expect(publishStep.with.command).toContain('electron-builder')
    expect(publishStep.with.command).toContain('--mac --publish never')
    expect(releaseMacWorkflowText).not.toContain('signpath/')
    expect(releaseMacWorkflowText).not.toContain('SIGNPATH_')
  })

  it('publishes both Linux release matrix entries', () => {
    const parsedWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const publishLinuxStep = parsedWorkflow.jobs.build.steps.find(
      (step) => step.name === 'Publish release artifacts (Linux)'
    )

    expect(publishLinuxStep.if).toContain("matrix.platform == 'linux-x64'")
    expect(publishLinuxStep.if).toContain("matrix.platform == 'linux-arm64'")
    expect(publishLinuxStep.with.command).toBe('${{ matrix.release_command }}')
  })
})
