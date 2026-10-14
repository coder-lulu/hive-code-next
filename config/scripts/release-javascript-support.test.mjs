import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { releaseJavascriptSupport } from './release-javascript-support.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('shared JavaScript build capability', () => {
  it('recognizes both declared product build phases', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts['build:release:javascript']).toEqual(expect.any(String))
    expect(pkg.scripts['build:release:host']).toEqual(expect.any(String))
    expect(releaseJavascriptSupport(process.cwd())).toEqual({ supported: true, reason: '' })
  })

  it.each(['build:release:javascript', 'build:release:host'])(
    'refuses a missing %s phase without building or measuring',
    async (missing) => {
      const fixtureRoot = join(process.cwd(), 'logs', 'shared-javascript-support-tests')
      mkdirSync(fixtureRoot, { recursive: true })
      const root = mkdtempSync(join(fixtureRoot, 'source-'))
      directories.push(root)
      const scripts = { 'build:release:javascript': 'fixture', 'build:release:host': 'fixture' }
      delete scripts[missing]
      writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts }))
      const support = releaseJavascriptSupport(root)
      expect(support).toEqual({
        supported: false,
        reason: 'This source has no shared JavaScript build commands.'
      })
      const reportDir = join(root, 'report')
      const argv = process.argv
      // The entry point resolves its own checkout; supply the real isolated fixture's capability.
      vi.doMock('./release-javascript-support.mjs', () => ({
        releaseJavascriptSupport: () => support
      }))
      vi.doMock('@orca/process-host', async (importOriginal) => ({
        ...(await importOriginal()),
        runProcessSync: vi.fn(() => {
          throw new Error('unsupported source must not spawn a build')
        })
      }))
      try {
        process.argv = ['node', 'benchmark', 'shared', reportDir]
        vi.resetModules()
        await import('./release-javascript-benchmark.mjs')
      } finally {
        process.argv = argv
        vi.doUnmock('./release-javascript-support.mjs')
        vi.doUnmock('@orca/process-host')
        vi.resetModules()
      }
      expect(JSON.parse(readFileSync(join(reportDir, 'unsupported.json'), 'utf8'))).toEqual({
        status: 'unsupported',
        reason: support.reason,
        buildsExecuted: 0
      })
      expect(readdirSync(reportDir).sort()).toEqual(['comparison.md', 'unsupported.json'])
      expect(readFileSync(join(reportDir, 'comparison.md'), 'utf8')).toContain(
        'No cross-platform measurements were performed.'
      )
    }
  )

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
