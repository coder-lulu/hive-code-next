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
  it('sets up the packageManager-pinned pnpm before caching and installing Linux dependencies', () => {
    const linux = readWorkflow('hivecode-linux-release.yml')
    const packageJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
    const steps = linux.jobs.build.steps
    const setup = steps.find((step) => step.uses === 'pnpm/setup@v2')
    const nodeSetup = steps.find((step) => step.uses === 'actions/setup-node@v6')
    const install = findStep(linux, 'build', 'Install locked dependencies')

    const toolchain = JSON.parse(readFileSync(join(projectDir, 'config/toolchain.json'), 'utf8'))
    expect(packageJson.packageManager.split('+')[0]).toBe(`pnpm@${toolchain.pnpm}`)
    expect(setup).toBeDefined()
    expect(setup.with).toEqual({ install: false })
    expect(steps.some((step) => step.uses?.startsWith('pnpm/action-setup@'))).toBe(false)
    expect(nodeSetup.with.cache).toBe('pnpm')
    expect(steps.indexOf(setup)).toBeLessThan(steps.indexOf(nodeSetup))
    expect(steps.indexOf(nodeSetup)).toBeLessThan(steps.indexOf(install))
    expect(install.run).toBe('pnpm install --frozen-lockfile')
  })

  it.each(['x64', 'arm64'])(
    'blocks %s Linux packaging on watcher fault recovery',
    (architecture) => {
      const linux = readWorkflow('hivecode-linux-release.yml')
      const build = linux.jobs.build
      const target = build.strategy.matrix.include.find(
        (entry) => entry.architecture === architecture
      )
      const steps = build.steps
      const compile = findStep(linux, 'build', 'Build application')
      const runtime = findStep(linux, 'build', 'Gate runtime file-watcher process isolation')
      const relay = findStep(linux, 'build', 'Gate SSH relay watcher process isolation')
      const pack = findStep(linux, 'build', 'Package AppImage without external publishing')

      expect(target.builder_arch).toBe(architecture)
      expect(target.runner).toMatch(/^ubuntu-/)
      expect(steps.indexOf(compile)).toBeLessThan(steps.indexOf(runtime))
      expect(steps.indexOf(runtime)).toBeLessThan(steps.indexOf(relay))
      expect(steps.indexOf(relay)).toBeLessThan(steps.indexOf(pack))
      expect(linux.jobs.publish.needs).toContain('build')
      expect(linux.jobs.publish.if).toBeUndefined()
      expect(build['continue-on-error']).toBeUndefined()
      for (const gate of [runtime, relay]) {
        expect(gate.if).toBeUndefined()
        expect(gate['continue-on-error']).toBeUndefined()
        expect(gate.shell).toBe('bash')
        expect(gate.env.ORCA_BACKGROUND_LAUNCH).toBe('1')
        expect(gate.run).toMatch(/^set -euo pipefail\n/)
        expect(gate.run).toContain('export TMPDIR="$GITHUB_WORKSPACE/logs/release-watcher-gates/')
        expect(gate.run).toContain('${{ matrix.architecture }}')
        expect(gate.run).toContain('mkdir -p "$TMPDIR"')
        expect(gate.run).not.toMatch(/\|\|\s*true|set \+e|\btimeout\b/)
      }
      expect(runtime.run).toContain(
        'node config/scripts/runtime-file-watcher-fault-harness.mjs 2>&1 | tee "$TMPDIR/../node.log"'
      )
      expect(runtime.run).toContain(
        'ELECTRON_RUN_AS_NODE=1 pnpm exec electron config/scripts/runtime-file-watcher-fault-harness.mjs 2>&1 | tee "$TMPDIR/../electron.log"'
      )
      expect(relay.run).toContain(
        'node config/scripts/relay-watcher-fault-harness.mjs 2>&1 | tee "$TMPDIR/../node.log"'
      )
    }
  )

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
