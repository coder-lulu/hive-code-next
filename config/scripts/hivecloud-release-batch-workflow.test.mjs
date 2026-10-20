import { readFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { runProcess } from '@orca/process-host'

const workflow = parse(
  readFileSync(new URL('../../.github/workflows/hivecode-publish-all.yml', import.meta.url), 'utf8')
)
const targets = ['windows', 'macos', 'linux', 'android', 'ios']

it('allows the full public artifact download matrix while keeping planning bounded', () => {
  expect(workflow.jobs.publish['timeout-minutes']).toBe(360)
  expect(workflow.jobs.plan['timeout-minutes']).toBe(10)
})

it('defaults to all clients and routes only explicitly selected batch members', () => {
  expect(workflow.on.workflow_dispatch.inputs.targets).toMatchObject({
    default: 'all',
    options: ['all', 'linux-android']
  })
  expect(workflow['run-name']).toContain('inputs.targets')
  for (const target of targets) {
    expect(workflow.jobs.plan.outputs[`${target}_selected`]).toBe(
      `\${{ steps.plan.outputs.${target}_selected }}`
    )
    expect(workflow.jobs[target].if).toContain(`needs.plan.outputs.${target}_selected == 'true'`)
  }
  for (const target of ['windows', 'macos', 'linux']) {
    expect(workflow.jobs.runtime.if).toContain(
      `needs.plan.outputs.${target}_selected == 'true' && needs.plan.outputs.${target}_ready != 'true'`
    )
  }
  for (const job of ['plan', 'publish']) {
    const request = workflow.jobs[job].steps.find((step) => step.env?.HIVECLOUD_RELEASE_SCOPE)
    expect(request.env.HIVECODE_RELEASE_TARGETS).toBe('${{ inputs.targets }}')
  }
})

it('accepts linux-android without Apple/Windows configuration but still requires Android and shared credentials', async () => {
  const absent = Object.fromEntries(
    Object.keys(preflight.env)
      .filter((name) => /^(MAC_|APPLE_|ASC_|IOS_|HIVECODE_MAC_|HIVECODE_WINDOWS_)/.test(name))
      .map((name) => [name, ''])
  )
  expect(
    (await checkReleaseConfiguration({ ...absent, HIVECODE_RELEASE_TARGETS: 'linux-android' })).code
  ).toBe(0)
  expect(
    (await checkReleaseConfiguration({ ...absent, HIVECODE_RELEASE_TARGETS: 'all' })).code
  ).not.toBe(0)
  for (const name of [
    'HIVECLOUD_API_CLIENT_ID',
    'HIVECLOUD_RELEASE_ATTESTATION_KEY',
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
    'HIVECODE_ANDROID_KEYSTORE_BASE64'
  ]) {
    const result = await checkReleaseConfiguration({
      ...absent,
      HIVECODE_RELEASE_TARGETS: 'linux-android',
      [name]: ''
    })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(name)
  }
})

it('checks explicit selection independently of readiness and rejects execution of an unselected client', async () => {
  const gate = workflow.jobs.publish.steps.find((step) =>
    step.name?.startsWith('Require every client')
  )
  const source = gate.run.split("<<'NODE'\n")[1].replace(/\nNODE\n?$/, '')
  const jobs = { plan: { outputs: {} } }
  for (const target of targets) {
    const selected = ['linux', 'android'].includes(target)
    jobs.plan.outputs[`${target}_selected`] = String(selected)
    jobs[target] = { result: selected ? 'success' : 'skipped' }
  }
  const run = () =>
    runProcess({
      program: process.execPath,
      args: ['--input-type=module', '-e', source],
      env: {
        ...process.env,
        RELEASE_JOB_RESULTS: JSON.stringify(jobs),
        HIVECODE_RELEASE_TARGETS: 'linux-android',
        ORCA_BACKGROUND_LAUNCH: '1'
      }
    })
  expect((await run()).code).toBe(0)
  jobs.windows.result = 'success'
  expect((await run()).stderr).toContain('Unselected client ran: windows')
  jobs.windows.result = 'skipped'
  jobs.plan.outputs.windows_selected = 'true'
  jobs.plan.outputs.windows_ready = 'true'
  expect((await run()).stderr).toContain('Release selection mismatch: windows')
})

it('allows OIDC only for protected publication jobs and binds their least-privilege scopes', () => {
  expect(workflow.permissions['id-token']).toBe('write')
  for (const [jobName, scope] of [
    ['plan', 'plan'],
    ['publish', 'publish']
  ]) {
    const job = workflow.jobs[jobName]
    expect(job.environment).toBe('release-production')
    expect(job.permissions['id-token']).toBe('write')
    const request = job.steps.find((step) => step.env?.HIVECLOUD_RELEASE_SCOPE)
    expect(request.env.HIVECLOUD_RELEASE_SCOPE).toBe(scope)
  }
  const artifactJobs = {
    windows: 'build-and-sign',
    macos: 'build-mac',
    linux: 'publish',
    android: 'android-build',
    ios: 'ios-distribute'
  }
  for (const [target, jobName] of Object.entries(artifactJobs)) {
    const caller = workflow.jobs[target]
    expect((caller.permissions ?? workflow.permissions)['id-token']).toBe('write')
    const child = parse(
      readFileSync(new URL(`../../${caller.uses.slice(2)}`, import.meta.url), 'utf8')
    )
    const job = child.jobs[jobName]
    expect(job.environment).toBe(
      target === 'windows'
        ? "${{ inputs.batch_id != '' && 'release-production' || 'hivecode-windows-signing' }}"
        : 'release-production'
    )
    expect(job.permissions['id-token']).toBe('write')
    const upload = job.steps.find((step) => step.env?.HIVECLOUD_RELEASE_BATCH_ID)
    expect(upload.env.HIVECLOUD_RELEASE_SCOPE).toBe(
      "${{ inputs.batch_id != '' && 'artifact' || '' }}"
    )
    expect(upload.env.HIVECLOUD_RELEASE_BATCH_ID).toBe('${{ inputs.batch_id }}')
    expect(upload.env.HIVECLOUD_RELEASE_ID).toBe('${{ inputs.release_id }}')
    for (const step of job.steps) {
      expect(step.run ?? '').not.toMatch(/echo.*ACTIONS_ID_TOKEN|GITHUB_ENV.*ACTIONS_ID_TOKEN/)
    }
  }
})

it('requires dispatching the exact selected release tag for OIDC issuance', () => {
  const gate = workflow.jobs.plan.steps.find(
    (step) => step.name === 'Require a trusted release trigger'
  )
  expect(gate.run).toContain('"$TRIGGER_REF" != "refs/tags/$SOURCE_REF"')
  expect(gate.run).not.toContain('[0-9a-f]{40}')
  expect(gate.run).toContain('source_ref must be a vSemVer release tag')
  const preflight = workflow.jobs.plan.steps.find(
    (step) => step.name === 'Require public release credentials and signing configuration'
  )
  expect(preflight.run).toContain("'ACTIONS_ID_TOKEN_REQUEST_URL'")
  expect(preflight.run).toContain("'ACTIONS_ID_TOKEN_REQUEST_TOKEN'")
  expect(preflight.run).not.toContain("'HIVECLOUD_API_TOKEN'")
})

it.each([
  'hivecode-publish-all.yml',
  'hivecode-linux-release.yml',
  'hivecode-windows-hardware-sign.yml',
  'release-mac-build.yml',
  'mobile-android-release.yml',
  'mobile-ios-release.yml'
])('%s supplies the management client identity for every management API request', (name) => {
  const definition = parse(
    readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8')
  )
  let requests = 0
  for (const job of Object.values(definition.jobs)) {
    for (const step of job.steps ?? []) {
      expect(step.env?.HIVECLOUD_API_TOKEN).toBeUndefined()
      if (step.env?.HIVECLOUD_API_URL) {
        requests += 1
        expect(step.env.HIVECLOUD_API_CLIENT_ID).toBe('${{ vars.HIVECLOUD_API_CLIENT_ID }}')
      }
    }
  }
  expect(requests).toBeGreaterThan(0)
})

const preflight = workflow.jobs.plan.steps.find(
  ({ name }) => name === 'Require public release credentials and signing configuration'
)
const preflightSource = preflight.run.split("<<'NODE'\n")[1].replace(/\nNODE\n?$/, '')
const signerAlternatives = [
  'HIVECODE_WINDOWS_EXPECTED_SIGNERS',
  'HIVECODE_WINDOWS_EXPECTED_THUMBPRINTS'
]
const requiredConfiguration = [
  ...Object.keys(preflight.env),
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN'
].filter((name) => !signerAlternatives.includes(name) && name !== 'HIVECODE_RELEASE_TARGETS')
const sentinel = 'private-test-value-must-not-appear-in-output'

async function checkReleaseConfiguration(overrides = {}) {
  return runProcess({
    program: process.execPath,
    args: ['--input-type=module', '-e', preflightSource],
    env: {
      ...process.env,
      ...Object.fromEntries(
        [
          ...Object.keys(preflight.env),
          'ACTIONS_ID_TOKEN_REQUEST_URL',
          'ACTIONS_ID_TOKEN_REQUEST_TOKEN'
        ].map((name) => [name, sentinel])
      ),
      HIVECODE_RELEASE_TARGETS: 'all',
      ...overrides,
      ORCA_BACKGROUND_LAUNCH: '1'
    }
  })
}

it('checks signing configuration after the trust boundary and before any reservation write', () => {
  const steps = workflow.jobs.plan.steps
  expect(steps.indexOf(preflight)).toBeGreaterThan(
    steps.findIndex((step) => step.name === 'Freeze source identity')
  )
  expect(steps.indexOf(preflight)).toBeLessThan(steps.findIndex((step) => step.id === 'plan'))
  expect(workflow.jobs.plan.environment).toBe('release-production')
  expect(preflight.if).toBeUndefined()
  expect(preflight['continue-on-error']).toBeUndefined()
  for (const name of [
    'MAC_CERTS',
    'ASC_API_KEY_P8',
    'IOS_DIST_CERT_P12',
    'HIVECODE_ANDROID_KEYSTORE_BASE64'
  ]) {
    expect(preflight.env[name]).toBe(`\${{ secrets.${name} }}`)
  }
})

it.each(requiredConfiguration)(
  'rejects missing %s without exposing credential values',
  async (name) => {
    const result = await checkReleaseConfiguration({ [name]: '   ' })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(`Missing release configuration: ${name}`)
    expect(result.stdout + result.stderr).not.toContain(sentinel)
  }
)

it('accepts either existing Windows identity mechanism but rejects missing both', async () => {
  for (const name of signerAlternatives) {
    const result = await checkReleaseConfiguration({ [name]: '' })
    expect(result.code).toBe(0)
    expect(result.stdout + result.stderr).not.toContain(sentinel)
  }
  const result = await checkReleaseConfiguration(
    Object.fromEntries(signerAlternatives.map((name) => [name, '']))
  )
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain(signerAlternatives.join(' or '))
  expect(result.stdout + result.stderr).not.toContain(sentinel)
})

it('rejects an arbitrary source commit before recording an identity or executing credential-bearing code', async () => {
  const directory = new URL('../../logs/release-batch/tests/', import.meta.url)
  mkdirSync(directory, { recursive: true })
  const temporary = mkdtempSync(new URL('source-', directory))
  try {
    const output = join(temporary, 'github.env')
    const freeze = workflow.jobs.plan.steps.find(({ name }) => name === 'Freeze source identity')
    expect(freeze.env.TRUSTED_SOURCE_SHA).toBe('${{ github.sha }}')
    const secretStep = workflow.jobs.plan.steps.find(({ name }) =>
      name?.startsWith('Reserve identities')
    )
    expect(workflow.jobs.plan.steps.indexOf(freeze)).toBeLessThan(
      workflow.jobs.plan.steps.indexOf(secretStep)
    )
    const bash =
      process.platform === 'win32'
        ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
        : 'bash'
    const result = await runProcess({
      program: bash,
      args: [
        '--noprofile',
        '--norc',
        '-c',
        `git() { if [[ "$1" == status ]]; then return 0; fi; printf '%s' "$SOURCE_REF"; }\n${freeze.run}`
      ],
      env: {
        ...process.env,
        SOURCE_REF: 'b'.repeat(40),
        TRUSTED_SOURCE_SHA: 'a'.repeat(40),
        GITHUB_ENV: output.replaceAll('\\', '/'),
        ORCA_BACKGROUND_LAUNCH: '1'
      }
    })
    expect(result.code).not.toBe(0)
    expect(result.stdout).toContain('Release source must equal the trusted workflow commit')
    expect(existsSync(output)).toBe(false)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

it('pins one source and reuses one qualified runtime for the complete client batch', () => {
  expect(workflow.concurrency['cancel-in-progress']).toBe(false)
  expect(workflow.jobs.runtime.uses).toContain('node-server-tests.yml')
  expect(workflow.jobs.runtime.with).toEqual({
    ref: '${{ needs.plan.outputs.source_sha }}',
    build_template: true
  })
  for (const target of targets) {
    const job = workflow.jobs[target]
    expect(job.uses).toContain('.github/workflows/')
    expect(job.secrets).toBe('inherit')
    expect(job.with).toMatchObject({
      source_sha: '${{ needs.plan.outputs.source_sha }}',
      release_version: '${{ needs.plan.outputs.version }}',
      release_channel: '${{ needs.plan.outputs.channel }}',
      batch_id: '${{ needs.plan.outputs.batch_id }}',
      runtime_run_id: '${{ github.run_id }}'
    })
    expect(job.with.release_id).toContain(`plan.outputs.${target}_release_id`)
    expect(job.with.release_build_number).toContain(`plan.outputs.${target}_build_number`)
    const called = parse(
      readFileSync(new URL(`../../${job.uses.slice(2)}`, import.meta.url), 'utf8')
    )
    for (const key of Object.keys(job.with)) {
      expect(called.on.workflow_call.inputs[key]).toBeDefined()
    }
  }
  expect(workflow.jobs.publish.needs).toEqual(['plan', 'runtime', ...targets])
  const step = workflow.jobs.publish.steps.find(({ name }) =>
    name?.startsWith('Atomically publish')
  )
  expect(step.run).toBe('node config/scripts/hivecloud-release-batch.mjs publish')
  expect(step.env.HIVECLOUD_RELEASE_BATCH_ID).toBe('${{ needs.plan.outputs.batch_id }}')
})

it.each(['failure', 'cancelled', 'skipped'])(
  'prevents any final API call when an unready client is %s',
  async (state) => {
    const jobs = { plan: { outputs: {} } }
    for (const target of targets) {
      jobs[target] = { result: 'success' }
      jobs.plan.outputs[`${target}_selected`] = 'true'
    }
    jobs.linux.result = state
    const gate = workflow.jobs.publish.steps.find(({ name }) =>
      name?.startsWith('Require every client')
    )
    const source = gate.run.split("<<'NODE'\n")[1].replace(/\nNODE\n?$/, '')
    const result = await runProcess({
      program: process.execPath,
      args: ['--input-type=module', '-e', source],
      env: {
        ...process.env,
        RELEASE_JOB_RESULTS: JSON.stringify(jobs),
        HIVECODE_RELEASE_TARGETS: 'all',
        ORCA_BACKGROUND_LAUNCH: '1'
      }
    })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Release batch is incomplete: linux')
  }
)

it('allows a rerun to reuse a complete verified target while rejecting false readiness', async () => {
  const jobs = { plan: { outputs: { linux_ready: 'true' } } }
  for (const target of targets) {
    jobs[target] = { result: 'success' }
    jobs.plan.outputs[`${target}_selected`] = 'true'
  }
  jobs.linux.result = 'skipped'
  const gate = workflow.jobs.publish.steps.find(({ name }) =>
    name?.startsWith('Require every client')
  )
  const source = gate.run.split("<<'NODE'\n")[1].replace(/\nNODE\n?$/, '')
  const result = await runProcess({
    program: process.execPath,
    args: ['--input-type=module', '-e', source],
    env: {
      ...process.env,
      RELEASE_JOB_RESULTS: JSON.stringify(jobs),
      HIVECODE_RELEASE_TARGETS: 'all',
      ORCA_BACKGROUND_LAUNCH: '1'
    }
  })
  expect(result.code).toBe(0)
})
