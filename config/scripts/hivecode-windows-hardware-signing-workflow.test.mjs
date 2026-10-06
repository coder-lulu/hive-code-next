import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflowPath = resolve(
  import.meta.dirname,
  '../../.github/workflows/hivecode-windows-hardware-sign.yml'
)

describe('HiveCode Windows hardware signing workflow', () => {
  it('uses a protected self-hosted Windows x64 runner and no retained product fallback', () => {
    const source = readFileSync(workflowPath, 'utf8')
    const workflow = parse(source)
    const job = workflow.jobs['build-and-sign']

    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch'])
    expect(workflow.on.push).toEqual({ tags: ['v*'] })
    expect(workflow.on.workflow_dispatch.inputs.release_version.required).toBe(true)
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(job['runs-on']).toEqual(['self-hosted', 'windows', 'x64'])
    expect(job.environment).toBe('hivecode-windows-signing')
    expect(job.if).toBe(
      "github.repository == 'coder-lulu/hive-code-next' && (startsWith(github.ref, 'refs/tags/v') || github.ref_protected == true)"
    )
    expect(source).not.toMatch(/continue-on-error/u)
    expect(source).not.toMatch(/signpath|stablyai\/orca/iu)
  })

  it('preflights before install/build and verifies before artifact upload', () => {
    const workflow = parse(readFileSync(workflowPath, 'utf8'))
    const steps = workflow.jobs['build-and-sign'].steps
    const names = steps.map((step) => step.name)
    const preflight = names.indexOf('Preflight protected hardware signing boundary')
    const install = names.indexOf('Install locked dependencies')
    const build = names.indexOf('Build and sign HiveCode Windows x64')
    const verify = names.indexOf('Verify final signed installer')
    const upload = names.indexOf('Upload verified HiveCode Windows artifacts')

    expect(preflight).toBeGreaterThan(-1)
    expect(preflight).toBeLessThan(install)
    expect(install).toBeLessThan(build)
    expect(build).toBeLessThan(verify)
    expect(verify).toBeLessThan(upload)
    expect(steps[preflight].run).toContain('--preflight-only')
    expect(steps[build].run).toBe('pnpm run build:win:x64:hardware-signed')
    expect(steps[verify].run).toContain('pnpm run verify:windows:hardware')
    expect(steps[upload].with['if-no-files-found']).toBe('error')
  })

  it('sources only public signing configuration from protected environment variables', () => {
    const workflow = parse(readFileSync(workflowPath, 'utf8'))
    const env = workflow.jobs['build-and-sign'].env

    const signingEnvironmentNames = [
      'HIVECODE_WINDOWS_EXPECTED_SIGNERS',
      'HIVECODE_WINDOWS_EXPECTED_THUMBPRINTS',
      'HIVECODE_WINDOWS_POWERSHELL_EXECUTABLE',
      'HIVECODE_WINDOWS_SIGNING_ARGUMENTS',
      'HIVECODE_WINDOWS_SIGNING_EXECUTABLE',
      'HIVECODE_WINDOWS_SIGNING_TIMEOUT_MS'
    ]
    expect(Object.keys(env).sort()).toEqual(
      [
        ...signingEnvironmentNames,
        'ORCA_REQUIRE_ORCAD_TEMPLATE',
        'ORCA_REQUIRE_RELAY_NATIVE_ADDONS'
      ].sort()
    )
    expect(env.ORCA_REQUIRE_ORCAD_TEMPLATE).toBe('1')
    expect(env.ORCA_REQUIRE_RELAY_NATIVE_ADDONS).toBe('x64,arm64')
    for (const name of signingEnvironmentNames) {
      const value = env[name]
      expect(value).toMatch(/^\$\{\{ vars\./u)
      expect(value).not.toContain('secrets.')
    }
  })
})
