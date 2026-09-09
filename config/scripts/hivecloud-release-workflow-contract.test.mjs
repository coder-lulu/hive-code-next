import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')

function readWorkflow(name) {
  return parse(readFileSync(join(projectDir, '.github/workflows', name), 'utf8'))
}

function findStep(workflow, job, name) {
  const step = workflow.jobs[job].steps.find((candidate) => candidate.name === name)
  expect(step, `${job}: ${name}`).toBeDefined()
  return step
}

describe('HiveCloud release publishing contract', () => {
  it('embeds release identity before packaging and publishes desktop artifacts to object storage', () => {
    const linux = readWorkflow('hivecode-linux-release.yml')
    const windows = readWorkflow('hivecode-windows-hardware-sign.yml')
    const mac = readWorkflow('release-mac-build.yml')

    expect(linux.jobs.build.env.HIVECODE_EMBED_RELEASE_IDENTITY).toBe('1')
    expect(mac.jobs['build-mac'].env.HIVECODE_EMBED_RELEASE_IDENTITY).toBe('1')
    expect(mac.jobs['build-mac'].if).toBe("github.repository == 'coder-lulu/hive-code-next'")
    expect(findStep(mac, 'build-mac', 'Reserve macOS build number in HiveCloud').run).toContain(
      'reserve-hivecloud-build-number.mjs'
    )
    expect(findStep(mac, 'build-mac', 'Build release artifacts (macOS)').with.command).toContain(
      '--mac --publish never'
    )
    expect(
      findStep(mac, 'build-mac', 'Publish macOS ZIP artifacts to HiveCloud object storage').run
    ).toContain('publish-hivecloud-desktop-release.mjs')
    expect(
      findStep(mac, 'build-mac', 'Verify macOS application signatures and certificates').run
    ).toContain('codesign --verify --deep --strict')
    expect(
      findStep(linux, 'publish', 'Publish AppImages to HiveCloud object storage').run
    ).toContain('publish-hivecloud-desktop-release.mjs')
    expect(findStep(linux, 'reserve', 'Reserve Linux build number in HiveCloud').run).toContain(
      'reserve-hivecloud-build-number.mjs'
    )
    expect(
      findStep(windows, 'build-and-sign', 'Resolve identity and reserve Windows build number').run
    ).toContain('reserve-hivecloud-build-number.mjs')
    expect(
      findStep(
        windows,
        'build-and-sign',
        'Publish verified Windows installer to HiveCloud object storage'
      ).run
    ).toContain('publish-hivecloud-desktop-release.mjs')
    expect(
      readFileSync(join(projectDir, 'config/scripts/build-windows-x64-hardware-signed.mjs'), 'utf8')
    ).toMatch(/'--publish',\s*'never'/)
  })

  it('keeps the Android release job off GitHub release asset uploads', () => {
    const workflowText = readFileSync(
      join(projectDir, '.github/workflows/mobile-android-release.yml'),
      'utf8'
    )
    const workflow = parse(workflowText)
    const publishStep = findStep(workflow, 'android-build', 'Publish signed APK to HiveCloud')
    const reservationStep = findStep(
      workflow,
      'android-build',
      'Reserve Android build number in HiveCloud'
    )
    const signingStep = findStep(workflow, 'android-build', 'Configure Android release signing')
    const verifyStep = findStep(
      workflow,
      'android-build',
      'Verify Android APK signature and certificate'
    )

    expect(signingStep.run).toContain('configure-android-release-signing.mjs')
    expect(verifyStep.run).toContain('apksigner verify --verbose --print-certs')
    expect(workflow.jobs['android-build'].if).toContain(
      "github.repository == 'coder-lulu/hive-code-next'"
    )
    expect(publishStep?.run).toContain('publish-hivecloud-release.mjs')
    expect(reservationStep.run).toContain('reserve-hivecloud-build-number.mjs')
    expect(workflowText).not.toContain('gh release upload')
    expect(workflowText).not.toContain('gh release create')
  })
})
