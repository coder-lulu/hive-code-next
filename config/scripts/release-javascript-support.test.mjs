import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { releaseJavascriptSupport } from './release-javascript-support.mjs'
import { describeProcessFailure, runProcessSync } from './script-child-process.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('host-bound shared JavaScript build refusal', () => {
  it('reports the real product Pack trust boundary before building or measuring anything', () => {
    const support = releaseJavascriptSupport(process.cwd())
    expect(support.supported).toBe(false)
    expect(support.reason).toContain('platform/architecture-specific Pack hashes')
    const fixtureRoot = join(process.cwd(), 'logs', 'shared-javascript-support-tests')
    mkdirSync(fixtureRoot, { recursive: true })
    const reportDir = mkdtempSync(join(fixtureRoot, 'comparison-'))
    directories.push(reportDir)
    const result = runProcessSync({
      program: process.execPath,
      args: [resolve('config/scripts/release-javascript-benchmark.mjs'), 'shared', reportDir],
      timeoutMs: 30_000
    })
    expect(result.code, describeProcessFailure(result)).toBe(0)
    expect(JSON.parse(readFileSync(join(reportDir, 'unsupported.json'), 'utf8'))).toEqual({
      status: 'unsupported',
      reason: support.reason,
      buildsExecuted: 0
    })
    expect(readdirSync(reportDir).sort()).toEqual(['comparison.md', 'unsupported.json'])
    expect(readFileSync(join(reportDir, 'comparison.md'), 'utf8')).toContain(
      'No cross-platform measurements were performed.'
    )
  })

  it('keeps consumer full builds while publishing an explicit unavailable comparison', () => {
    const bundle = parse(readFileSync('.github/workflows/release-javascript.yml', 'utf8'))
    const comparison = parse(
      readFileSync('.github/workflows/release-javascript-benchmark.yml', 'utf8')
    )
    expect(bundle.on.workflow_call.secrets).toBeUndefined()
    expect(bundle.on.workflow_call.outputs.reason).toBeDefined()
    expect(comparison.jobs.measure.if).toBe("needs.bundle.outputs.supported == 'true'")
    expect(comparison.jobs.unsupported.if).toBe("needs.bundle.outputs.supported != 'true'")
    for (const [file, job] of [
      ['release-cut.yml', 'build'],
      ['release-mac-build.yml', 'build-mac']
    ]) {
      const workflow = parse(readFileSync(join('.github/workflows', file), 'utf8'))
      const build = workflow.jobs[job].steps.find((step) => step.name === 'Build app')
      expect(build.run).toMatch(/else\s+pnpm run build:release\s+fi/)
      expect(build.env.ORCA_DIAGNOSTICS_TOKEN_URL).toBeUndefined()
      expect(build.env.ORCA_POSTHOG_WRITE_KEY).toBeUndefined()
    }
  })
})
