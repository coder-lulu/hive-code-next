// Every shipped desktop package carries Windows relays, so each must stage the
// launcher-capable process-tree addon, not only the Windows packages that can compile it.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const readWorkflow = (name) =>
  parse(readFileSync(join(projectDir, '.github/workflows', name), 'utf8'))

const ARTIFACT = 'relay-windows-process-tree'
const ADDON_WORKFLOW = './.github/workflows/relay-windows-process-tree.yml'
const BUILD_BOTH_ARCHES = [
  'node config/scripts/build-windows-process-tree-relay-addon.mjs --arch=x64',
  'node config/scripts/build-windows-process-tree-relay-addon.mjs --arch=arm64'
]

// [workflow, packaging job, job that produces the artifact in the same run]
const DOWNLOADING_PACKAGERS = [['release-cut.yml', 'build', 'relay-windows-process-tree']]

function stepIndex(job, predicate, label) {
  const index = job.steps.findIndex(predicate)
  expect(index, label).toBeGreaterThanOrEqual(0)
  return index
}

function expectRequiredBeforeBuild(job, stagingIndex) {
  const build = stepIndex(
    job,
    (step) => /pnpm (run )?build:release\b/.test(step.run ?? ''),
    'build'
  )
  expect(stagingIndex).toBeLessThan(build)
  expect(job.steps[build].env.ORCA_REQUIRE_RELAY_NATIVE_ADDONS).toBe('x64,arm64')
}

const isDownload = (step) =>
  step.uses?.startsWith('actions/download-artifact@') && step.with?.name === ARTIFACT

describe('relay Windows process-tree addon in every desktop package', () => {
  it('builds both arches once on a GitHub-hosted Windows runner and uploads them', () => {
    const job = readWorkflow('relay-windows-process-tree.yml').jobs.build
    expect(job['runs-on']).toBe('windows-2022')
    const build = job.steps.find((step) => step.name?.startsWith('Build Windows process-table'))
    expect(build.run.trim().split('\n')).toEqual(BUILD_BOTH_ARCHES)
    const upload = job.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))
    expect(upload.with).toMatchObject({
      name: ARTIFACT,
      path: '.build/windows-process-tree/',
      'if-no-files-found': 'error'
    })
  })

  it.each(DOWNLOADING_PACKAGERS)(
    '%s %s downloads the addons and requires them',
    (workflowName, jobName, producer) => {
      const { jobs } = readWorkflow(workflowName)
      expect(jobs[producer].uses).toBe(ADDON_WORKFLOW)
      expect([jobs[jobName].needs].flat()).toContain(producer)
      const job = jobs[jobName]
      const download = stepIndex(job, isDownload, 'download')
      expect(job.steps[download].with.path).toBe('.build/windows-process-tree')
      expectRequiredBeforeBuild(job, download)
    }
  )

  it('builds the release addons from the tag the packages are cut from', () => {
    const { jobs } = readWorkflow('release-cut.yml')
    expect(jobs[ARTIFACT].with.ref).toBe('refs/tags/${{ needs.cut.outputs.tag }}')
    // The mac build is a separate dispatched run that downloads from this one.
    expect(jobs['build-mac'].needs).toContain(ARTIFACT)
  })

  it('has the dispatched mac release build download from the release-cut run', () => {
    const job = readWorkflow('release-mac-build.yml').jobs['build-mac']
    expect(job.permissions).toMatchObject({ actions: 'read' })
    const download = stepIndex(job, isDownload, 'download')
    expect(job.steps[download].with['run-id']).toBe('${{ inputs.release_run_id }}')
    expectRequiredBeforeBuild(job, download)
  })

  it.each([
    'hourly-mac-build.yml',
    'daily-mac-build.yml',
    'adhoc-mac-build.yml',
    'dev-channel-win-build.yml'
  ])('keeps the superseded %s publisher retired', (name) => {
    const workflow = readWorkflow(name)
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual(['retired'])
    expect(workflow.jobs.retired.steps[0].run).toContain('exit 1')
    expect(workflow.jobs[ARTIFACT]).toBeUndefined()
  })

  it('qualifies and stages both native addons and the current server in the owned client packages', () => {
    const { jobs } = readWorkflow('hivecode-client-build.yml')
    expect(jobs['relay-native-addons'].uses).toBe(ADDON_WORKFLOW)
    expect(jobs['relay-native-addons'].with.ref).toBe('${{ github.sha }}')
    expect(jobs['desktop-runtime'].uses).toBe('./.github/workflows/node-server-tests.yml')
    expect(jobs['desktop-runtime'].with).toEqual({ ref: '${{ github.sha }}', build_template: true })
    expect(jobs.build.needs).toEqual(['plan', 'desktop-runtime', 'relay-native-addons'])
    expect(jobs.build.if).toContain("needs.relay-native-addons.result == 'success'")
    expect(jobs.build.if).toContain("needs.desktop-runtime.result == 'success'")
    const compile = stepIndex(
      jobs.build,
      (step) => step.run?.includes('clients:prepare'),
      'client preparation'
    )
    const addons = stepIndex(jobs.build, isDownload, 'addons')
    const template = stepIndex(
      jobs.build,
      (step) => step.with?.name === 'orcad-template',
      'template'
    )
    const required = stepIndex(
      jobs.build,
      (step) => step.name === 'Require runtime resources in desktop packages',
      'resource guard'
    )
    expect(addons).toBeLessThan(compile)
    expect(template).toBeLessThan(compile)
    expect(required).toBeLessThan(compile)
    expect(jobs.build.steps[required].run).toContain('ORCA_REQUIRE_RELAY_NATIVE_ADDONS=x64,arm64')
    expect(jobs.build.steps[required].run).toContain('ORCA_REQUIRE_ORCAD_TEMPLATE=1')
  })

  it.each([
    ['hivecode-linux-release.yml', 'build', 'Build application'],
    ['hivecode-windows-hardware-sign.yml', 'build-and-sign', 'Build and sign HiveCode Windows x64']
  ])('requires the same qualified runtime resources in %s', (name, jobName, compileName) => {
    const { jobs } = readWorkflow(name)
    expect(jobs['relay-native-addons'].uses).toBe(ADDON_WORKFLOW)
    expect(jobs['relay-native-addons'].with.ref).toBe('${{ github.sha }}')
    expect(jobs['desktop-runtime'].uses).toBe('./.github/workflows/node-server-tests.yml')
    expect(jobs['desktop-runtime'].with).toEqual({ ref: '${{ github.sha }}', build_template: true })
    const job = jobs[jobName]
    expect([job.needs].flat()).toContain('desktop-runtime')
    expect([job.needs].flat()).toContain('relay-native-addons')
    const compile = stepIndex(job, (step) => step.name === compileName, 'compile')
    expect(stepIndex(job, isDownload, 'addons')).toBeLessThan(compile)
    expect(stepIndex(job, (step) => step.with?.name === 'orcad-template', 'template')).toBeLessThan(
      compile
    )
    expect(job.env.ORCA_REQUIRE_RELAY_NATIVE_ADDONS).toBe('x64,arm64')
    expect(job.env.ORCA_REQUIRE_ORCAD_TEMPLATE).toBe('1')
    expect(job['continue-on-error']).toBeUndefined()
  })
})
