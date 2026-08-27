import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(
  readFileSync(join(projectDir, 'config/upstream-sync-gates.json'), 'utf8')
)
const workflow = readFileSync(join(projectDir, '.github/workflows/upstream-sync.yml'), 'utf8')

describe('upstream synchronization fixed gates', () => {
  it('keeps the required product-boundary categories explicit', () => {
    const checks = Object.values(manifest.suites).flat()
    expect(new Set(checks.map((check) => check.id)).size).toBe(checks.length)
    expect(new Set(checks.map((check) => check.category))).toEqual(
      new Set([
        'brand',
        'hivecloud',
        'updater',
        'mobile',
        'runtime-rpc',
        'platform',
        'generated',
        'lockfile'
      ])
    )
  })

  it('keeps every declared test path present in its working directory', () => {
    for (const checks of Object.values(manifest.suites)) {
      for (const check of checks) {
        for (const testPath of check.paths ?? []) {
          expect(
            existsSync(join(projectDir, check.cwd, testPath)),
            `${check.id}: ${testPath}`
          ).toBe(true)
        }
      }
    }
  })

  it('runs common gates and a three-runner platform matrix before promotion', () => {
    expect(workflow).toContain('run-upstream-sync-gates.mjs --suite=common')
    expect(workflow).toContain('run-upstream-sync-gates.mjs --suite=platform')
    expect(workflow).toContain('ubuntu-latest')
    expect(workflow).toContain('windows-latest')
    expect(workflow).toContain('macos-latest')
    expect(workflow).toContain('platform-gates')
    expect(workflow).toContain("needs.platform-gates.result == 'success'")
  })

  it('tracks only the upstream delta from the previous vendor base', () => {
    expect(workflow).toContain('vendor_base_sha: ${{ steps.sync.outputs.vendor_base_sha }}')
    expect(workflow).toContain('track-upstream-changes.mjs')
    expect(workflow).toContain('--base "$VENDOR_BASE_SHA"')
    expect(workflow).toContain('--head "$UPSTREAM_SHA"')
    expect(workflow).toContain('upstream-change-intake.md')
  })
})
