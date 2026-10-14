import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const readWorkflow = (name) =>
  parse(readFileSync(join(projectDir, '.github/workflows', name), 'utf8'))
const ARTIFACT = 'orcad-windows-process-tree'
const TEMPLATE = 'orcad-template'
const CURRENT_OWNER = './.github/workflows/node-server-tests.yml'
const downloadIndex = (job, artifact) => {
  const index = job.steps.findIndex(
    (step) => step.uses?.startsWith('actions/download-artifact@') && step.with?.name === artifact
  )
  expect(index, `required ${artifact} download`).toBeGreaterThanOrEqual(0)
  expect(job.steps[index]['continue-on-error']).toBeUndefined()
  return index
}

describe('current Windows process-tree packaging owner', () => {
  it('compiles both architectures and proves creation-time semantics through the existing Runtime owner', () => {
    expect(existsSync(join(projectDir, '.github/workflows/relay-windows-process-tree.yml'))).toBe(
      false
    )
    const workflow = readWorkflow('node-server-tests.yml')
    const steps = workflow.jobs.persistence.steps
    const build = steps.find(
      (step) => step.name === 'Build the Windows process-table addons for the desktop template'
    )
    expect(build.if).toBe("inputs.build_template && matrix.os == 'windows-2022'")
    for (const arch of ['x64', 'arm64']) {
      expect(build.run).toContain(
        `node config/scripts/build-windows-process-tree-addon.mjs --arch=${arch}`
      )
    }
    expect(build.run).toContain('assertWindowsProcessTreeCreationTime({ module: addon })')
    expect(build.run).toContain('Math.abs(own - started) > 5000')
    expect(build.run).toContain('addon.getProcessCreationTime(0x7ffffff0) !== undefined')
    const upload = steps.find(
      (step) => step.uses?.startsWith('actions/upload-artifact@') && step.with?.name === ARTIFACT
    )
    expect(upload.if).toBe(build.if)
    expect(upload.with).toMatchObject({
      path: '.build/windows-process-tree/',
      'if-no-files-found': 'error'
    })
    expect(steps.indexOf(build)).toBeLessThan(steps.indexOf(upload))
    const template = workflow.jobs.desktop_template
    expect(template.needs).toContain('persistence')
    expect(template.if).toContain("needs.persistence.result == 'success'")
    expect(template.steps[downloadIndex(template, ARTIFACT)].with.path).toBe(
      '.build/windows-process-tree'
    )
    expect(
      template.steps.findIndex((step) => step.run === 'pnpm build:orcad-template')
    ).toBeGreaterThan(downloadIndex(template, ARTIFACT))
  })

  it.each([
    ['hivecode-client-build.yml', 'build', 'clients:prepare'],
    ['hivecode-linux-release.yml', 'build', 'pnpm build:'],
    ['hivecode-windows-hardware-sign.yml', 'build-and-sign', 'pnpm run build:']
  ])(
    '%s consumes the same qualified Runtime and native artifact without a second producer',
    (name, jobName, buildCommand) => {
      const { jobs } = readWorkflow(name)
      expect(jobs['relay-native-addons']).toBeUndefined()
      expect(jobs['desktop-runtime'].uses).toBe(CURRENT_OWNER)
      expect(jobs['desktop-runtime'].with).toEqual({
        ref: '${{ github.sha }}',
        build_template: true
      })
      const job = jobs[jobName]
      expect([job.needs].flat()).toContain('desktop-runtime')
      const compile = job.steps.findIndex((step) => step.run?.includes(buildCommand))
      expect(compile).toBeGreaterThanOrEqual(0)
      expect(downloadIndex(job, ARTIFACT)).toBeLessThan(compile)
      expect(downloadIndex(job, TEMPLATE)).toBeLessThan(compile)
      expect(job.steps[downloadIndex(job, ARTIFACT)].with.path).toBe('.build/windows-process-tree')
      if (name === 'hivecode-client-build.yml') {
        expect(job.if).toContain("needs.desktop-runtime.result == 'success'")
        expect(job.if).toContain("needs.desktop-runtime.result == 'skipped'")
        expect(
          job.steps.find((step) => step.name === 'Require runtime resources in desktop packages')
            .run
        ).toContain('ORCA_REQUIRE_ORCAD_TEMPLATE=1')
      } else {
        expect(job.env.ORCA_REQUIRE_ORCAD_TEMPLATE).toBe('1')
      }
      expect(job['continue-on-error']).toBeUndefined()
    }
  )

  it('retains the release tag and cross-run mac template provenance', () => {
    const { jobs } = readWorkflow('release-cut.yml')
    expect(jobs[TEMPLATE].uses).toBe(CURRENT_OWNER)
    expect(jobs[TEMPLATE].with).toEqual({
      ref: 'refs/tags/${{ needs.cut.outputs.tag }}',
      build_template: true
    })
    expect(jobs.build.needs).toContain(TEMPLATE)
    expect(jobs['build-mac'].needs).toContain(TEMPLATE)
    expect(jobs.build.env.ORCA_REQUIRE_ORCAD_TEMPLATE).toBe('1')
    downloadIndex(jobs.build, TEMPLATE)
    const mac = readWorkflow('release-mac-build.yml').jobs['build-mac']
    expect(mac.permissions).toMatchObject({ actions: 'read' })
    expect(mac.steps[downloadIndex(mac, TEMPLATE)].with['run-id']).toBe(
      '${{ inputs.release_run_id }}'
    )
  })

  it.each([
    'hourly-mac-build.yml',
    'daily-mac-build.yml',
    'adhoc-mac-build.yml',
    'dev-channel-win-build.yml'
  ])('keeps %s retired', (name) => {
    const workflow = readWorkflow(name)
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual(['retired'])
    expect(workflow.jobs.retired.steps[0].run).toContain('exit 1')
  })
})
