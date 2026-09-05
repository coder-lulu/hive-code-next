import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { selectChecks } from './run-upstream-sync-gates.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(
  readFileSync(join(projectDir, 'config/upstream-sync-gates.json'), 'utf8')
)
const workflow = readFileSync(join(projectDir, '.github/workflows/upstream-sync.yml'), 'utf8')
const matrix = JSON.parse(
  readFileSync(join(projectDir, 'config/upstream-regression-matrix.json'), 'utf8')
)

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
    expect(workflow).toContain('run-upstream-sync-gates.mjs --suite=regression')
    expect(workflow).toContain('ubuntu-latest')
    expect(workflow).toContain('windows-latest')
    expect(workflow).toContain('macos-latest')
    expect(workflow).toContain('platform-gates')
    expect(workflow).toContain("needs.platform-gates.result == 'success'")
  })

  it('keeps the product review position separate from the vendor publication lease', () => {
    expect(workflow).toContain('vendor_base_sha: ${{ steps.sync.outputs.vendor_base_sha }}')
    expect(workflow).toContain('track-upstream-changes.mjs')
    expect(workflow).toContain('--state-ref "$TARGET_SHA"')
    expect(workflow).toContain('--head "$UPSTREAM_SHA"')
    expect(workflow).toContain('upstream-change-intake.md')
  })

  it('executes the focused contracts on every OS and CLI checks on Windows without duplicates', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const checks = selectChecks({ manifest, matrix, suite: 'regression', platform })
      expect(checks.map((check) => check.id)).toEqual(
        platform === 'win32' ? ['pty-wsl-ssh', 'windows-cli-typecheck'] : ['pty-wsl-ssh']
      )
      const all = selectChecks({ manifest, matrix, suite: 'all', platform })
      expect(all.filter((check) => check.id === 'pty-wsl-ssh')).toHaveLength(1)
      for (const check of checks) {
        for (const testPath of check.paths ?? []) {
          expect(existsSync(join(projectDir, check.cwd, testPath))).toBe(true)
        }
      }
    }
  })

  it('refuses a missing platform or conflicting gate instead of silently skipping coverage', () => {
    expect(() =>
      selectChecks({ manifest, matrix, suite: 'regression', platform: 'freebsd' })
    ).toThrow(/coverage/)
    const conflicting = structuredClone(matrix)
    conflicting.platforms.windows.checks.push({
      ...manifest.suites.platform[0],
      argv: ['echo', 'skip']
    })
    expect(() =>
      selectChecks({ manifest, matrix: conflicting, suite: 'regression', platform: 'win32' })
    ).toThrow(/Conflicting/)
  })
})
