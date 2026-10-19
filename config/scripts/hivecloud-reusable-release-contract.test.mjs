import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const targets = [
  ['hivecode-linux-release.yml', 'publish'],
  ['hivecode-windows-hardware-sign.yml', 'build-and-sign'],
  ['release-mac-build.yml', 'build-mac'],
  ['mobile-android-release.yml', 'android-build']
]
const read = (name) =>
  parse(readFileSync(resolve(import.meta.dirname, '../../.github/workflows', name), 'utf8'))

describe('reusable batch release workflows', () => {
  it('keeps HiveCloud publication exclusive to batch calls without CI bearer credentials', () => {
    for (const [name, jobName] of targets) {
      const workflow = read(name)
      expect(JSON.stringify(workflow)).not.toContain('HIVECLOUD_API_TOKEN')
      expect(JSON.stringify(workflow)).not.toContain('reserve-hivecloud-build-number.mjs')
      expect(workflow.on.workflow_dispatch.inputs.publish_release).toBeUndefined()
      expect(workflow.on.workflow_dispatch.inputs.publish_hivecloud_release).toBeUndefined()
      const job = workflow.jobs[jobName]
      const upload = job.steps.find((step) => step.run?.includes('publish-hivecloud-'))
      if (name === 'hivecode-linux-release.yml') {
        expect(workflow.on.push).toBeUndefined()
        expect(job.if).toContain("inputs.batch_id != ''")
        expect(job.if).not.toContain("github.event_name == 'push'")
      } else {
        expect(upload.if).toBe("inputs.batch_id != ''")
      }
    }
    const upstream = JSON.stringify(read('release-cut.yml'))
    expect(upstream).not.toContain('HIVECLOUD_API_TOKEN')
    expect(upstream).not.toContain('publish-hivecloud-desktop-release.mjs')
  })

  it.each([
    ['hivecode-linux-release.yml', 'reserve'],
    ['hivecode-windows-hardware-sign.yml', 'build-and-sign'],
    ['release-mac-build.yml', 'build-mac'],
    ['mobile-android-release.yml', 'android-build']
  ])(
    '%s rejects a batch source outside the trusted triggering commit before starting the job',
    (name, job) => {
      expect(read(name).jobs[job].if).toContain(
        "(inputs.batch_id == '' || inputs.source_sha == github.sha) &&"
      )
    }
  )

  it.each(targets)('%s consumes frozen identity and only stages the batch draft', (name, job) => {
    const workflow = read(name)
    for (const input of [
      'source_sha',
      'release_version',
      'release_channel',
      'release_build_number',
      'release_id',
      'batch_id',
      'runtime_run_id'
    ]) {
      expect(workflow.on.workflow_call.inputs[input]).toEqual({ required: true, type: 'string' })
    }
    expect(workflow.on.workflow_dispatch).toBeDefined()
    for (const definition of Object.values(workflow.jobs)) {
      for (const step of definition.steps ?? []) {
        if (step.uses?.startsWith('actions/checkout@')) {
          expect(step.with.ref).toContain('inputs.source_sha')
        }
      }
    }
    const publish = workflow.jobs[job].steps.find((step) =>
      step.run?.includes('publish-hivecloud-')
    )
    expect(publish.env.HIVECODE_COMMIT_SHA).toContain('inputs.source_sha')
    expect(publish.env.HIVECLOUD_RELEASE_ID).toBe('${{ inputs.release_id }}')
    expect(publish.env.HIVECLOUD_RELEASE_BATCH_ID).toBe('${{ inputs.batch_id }}')
    expect(publish.env.HIVECODE_PUBLISH).toBe("${{ inputs.batch_id != '' && 'false' || 'true' }}")
    expect(JSON.stringify(workflow)).not.toContain("github.event_name == 'workflow_call'")
    expect(JSON.stringify(workflow)).not.toContain('gh release upload')
  })

  it.each(targets.slice(0, 2))(
    '%s reuses the parent runtime even when its local runtime job is skipped',
    (name) => {
      const workflow = read(name)
      expect(workflow.jobs['desktop-runtime'].if).toContain("inputs.batch_id == ''")
      const build = workflow.jobs.build ?? workflow.jobs['build-and-sign']
      expect(build.if).toContain('!cancelled()')
      expect(build.if).toContain("needs.desktop-runtime.result == 'skipped'")
      expect(build.if).toContain("inputs.batch_id != ''")
      for (const step of build.steps.filter((step) =>
        step.uses?.startsWith('actions/download-artifact@')
      )) {
        expect(step.with['run-id']).toBe('${{ inputs.runtime_run_id || github.run_id }}')
        expect(step.with['github-token']).toBe('${{ github.token }}')
      }
    }
  )

  it('does not reserve or push Android tags in batch mode, and still uploads signed APKs', () => {
    const workflow = read('mobile-android-release.yml')
    const steps = workflow.jobs['android-build'].steps
    for (const name of ['Reserve Android build number in HiveCloud', 'Ensure GitHub release tag']) {
      expect(steps.find((step) => step.name === name)).toBeUndefined()
    }
    const upload = steps.find((step) => step.name === 'Publish signed APK to HiveCloud')
    expect(upload.if).toContain("inputs.batch_id != ''")
    expect(upload.env.HIVECODE_ANDROID_ARCHITECTURE).toBe('universal')
    expect(upload.env.HIVECODE_RELEASE_CHANNEL).toContain('inputs.release_channel')
    expect(steps.find((step) => step.name === 'Validate reserved Android identity').run).toContain(
      'test "$RESERVED_BUILD_NUMBER" = "$ACTUAL_BUILD_NUMBER"'
    )
  })

  it('skips desktop reservation while validating the supplied version, channel, and build number', () => {
    const linux = read(targets[0][0])
    expect(linux.jobs.reserve.steps.find((step) => step.id === 'reserve')).toBeUndefined()
    expect(linux.jobs.reserve.steps.find((step) => step.id === 'identity').run).toContain(
      'build_number="$RESERVED_BUILD_NUMBER"'
    )
    const windows = read(targets[1][0])
    expect(
      windows.jobs['build-and-sign'].steps.find((step) => step.name.startsWith('Resolve identity'))
        .run
    ).toContain('if ($env:BATCH_ID)')
    const mac = read(targets[2][0])
    expect(
      mac.jobs['build-mac'].steps.find((step) => step.name?.startsWith('Reserve macOS'))
    ).toBeUndefined()
    expect(mac.jobs['build-mac'].env.HIVECODE_BUILD_NUMBER).toBe(
      '${{ inputs.release_build_number }}'
    )
    expect(mac.jobs['build-mac'].steps.find((step) => step.id === 'tag-classify').run).toContain(
      'test "$channel" = "$RELEASE_CHANNEL"'
    )
  })
})
