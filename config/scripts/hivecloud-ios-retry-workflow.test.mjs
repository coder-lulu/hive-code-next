import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { runProcess } from '@orca/process-host'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(
  readFileSync(new URL('../../.github/workflows/hivecode-publish-all.yml', import.meta.url), 'utf8')
)
const steps = workflow.jobs.publish.steps
const availability = steps.find(
  (step) => step.name === 'Recheck Apple availability before batch publication'
)

it('checks Apple in the final publication job after all artifacts and before the atomic publish', () => {
  expect(availability).toBeDefined()
  const gate = steps.find((step) => step.name?.startsWith('Require every client'))
  const publish = steps.find(
    (step) => step.name === 'Atomically publish and verify all public artifacts'
  )
  const ruby = steps.find((step) => step.name === 'Setup Ruby for final Apple availability check')
  expect(steps.indexOf(ruby)).toBeGreaterThan(steps.indexOf(gate))
  expect(steps.indexOf(availability)).toBeGreaterThan(steps.indexOf(ruby))
  expect(steps.indexOf(availability)).toBeLessThan(steps.indexOf(publish))
  expect(ruby.with).toMatchObject({
    'ruby-version': '3.3',
    'bundler-cache': true,
    'working-directory': 'mobile'
  })
  expect(ruby.env.BUNDLE_FROZEN).toBe('true')
  expect(availability['continue-on-error']).toBeUndefined()
  expect(availability['timeout-minutes']).toBeLessThanOrEqual(10)
})

it('rechecks verified links and previous successful iOS jobs on every unpublished attempt', () => {
  expect(availability).toBeDefined()
  const ruby = steps.find((step) => step.name === 'Setup Ruby for final Apple availability check')
  for (const iosReady of ['true', 'false']) {
    for (const previousIosResult of ['success', 'skipped']) {
      const needs = {
        plan: {
          outputs: { ios_selected: 'true', ios_ready: iosReady, already_published: 'false' }
        },
        ios: { result: previousIosResult }
      }
      for (const step of [ruby, availability]) {
        expect(runInNewContext(step.if, { needs })).toBe(true)
      }
    }
  }
  for (const outputs of [
    { ios_selected: 'false', already_published: 'false' },
    { ios_selected: 'true', already_published: 'true' }
  ]) {
    expect(runInNewContext(availability.if, { needs: { plan: { outputs } } })).toBe(false)
  }
})

it('binds the last Apple check to the same frozen version, native build, channel and store URL', () => {
  expect(availability).toBeDefined()
  expect(availability['working-directory']).toBe('mobile')
  expect(availability.env).toMatchObject({
    ASC_KEY_ID: '${{ secrets.ASC_KEY_ID }}',
    ASC_ISSUER_ID: '${{ secrets.ASC_ISSUER_ID }}',
    ASC_API_KEY_P8: '${{ secrets.ASC_API_KEY_P8 }}',
    HIVECODE_IOS_TESTFLIGHT_GROUPS: '${{ vars.HIVECODE_IOS_TESTFLIGHT_GROUPS }}',
    HIVECODE_IOS_STORE_URL:
      "${{ needs.plan.outputs.channel == 'beta' && vars.HIVECODE_IOS_TESTFLIGHT_URL || vars.HIVECODE_IOS_APP_STORE_URL }}",
    BATCH_VERSION: '${{ needs.plan.outputs.version }}',
    BATCH_BUILD: '${{ needs.plan.outputs.ios_build_number }}',
    BATCH_CHANNEL: '${{ needs.plan.outputs.channel }}'
  })
})

it.each([0, 1])(
  'reaches publication only if the final Apple command succeeds (exit %i)',
  async (exitCode) => {
    expect(availability).toBeDefined()
    const bash =
      process.platform === 'win32'
        ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
        : 'bash'
    const result = await runProcess({
      program: bash,
      args: [
        '--noprofile',
        '--norc',
        '-e',
        '-o',
        'pipefail',
        '-c',
        `bundle() { printf '%s\\n' "$@"; return "$APPLE_EXIT"; }\n${availability.run}\nprintf PUBLICATION_REACHED`
      ],
      env: {
        ...process.env,
        APPLE_EXIT: String(exitCode),
        BATCH_VERSION: '1.5.0-beta.36',
        BATCH_BUILD: '5',
        BATCH_CHANNEL: 'beta',
        ORCA_BACKGROUND_LAUNCH: '1'
      }
    })
    expect(result.code).toBe(exitCode)
    expect(result.stdout).toContain(
      'exec\nfastlane\nios\nverify_batch_availability\nversion:1.5.0-beta.36\nbuild_number:5\nchannel:beta'
    )
    expect(result.stdout.includes('PUBLICATION_REACHED')).toBe(exitCode === 0)
  }
)
