import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildMatrix, ciTargets } from './client-build-ci-plan.mjs'
import { targets, selectTargets } from './client-build-contract.mjs'

describe('native CI package coverage', () => {
  it('covers every supported client on a host accepted by preflight', () => {
    expect(ciTargets.map((row) => row.target).sort()).toEqual(Object.keys(targets).sort())
    for (const { target, runner } of ciTargets) {
      const platform = runner.startsWith('windows')
        ? 'win32'
        : runner.startsWith('macos')
          ? 'darwin'
          : 'linux'
      const arch =
        runner.endsWith('-arm') || (runner.startsWith('macos') && !runner.endsWith('intel'))
          ? 'arm64'
          : 'x64'
      expect(selectTargets(target, platform, arch)).toEqual([target])
    }
  })
  it('permits bounded retries while refusing unknown or injected selections', () => {
    expect(buildMatrix().include).toHaveLength(7)
    expect(buildMatrix('ios').include).toEqual([{ target: 'ios', runner: 'macos-26' }])
    expect(() => buildMatrix('android; echo secret')).toThrow('Unsupported')
    expect(() => buildMatrix('../../outside')).toThrow('Unsupported')
  })
  it('retains automatic full builds, strict failure propagation and secret cleanup', () => {
    const workflow = readFileSync(
      new URL('../../.github/workflows/hivecode-client-build.yml', import.meta.url),
      'utf8'
    )
    expect(workflow).toContain('branches: [hivecode/main-next]')
    expect(workflow).toContain("BUILD_TARGET: ${{ inputs.target || 'all' }}")
    expect(workflow).toContain('fail-fast: false')
    const documentationGate = 'node config/scripts/verify-documentation-governance.mjs'
    expect(workflow).toContain(documentationGate)
    expect(workflow.indexOf(documentationGate)).toBeLessThan(workflow.indexOf('- id: plan'))
    expect(workflow).not.toMatch(/submodules:\s*(true|recursive)/)
    expect(workflow).toContain('git diff --exit-code HEAD')
    expect(workflow).toContain("if: always() && matrix.target == 'android'")
    expect(workflow).toContain('No installable IPA is produced.')
    expect(workflow).not.toContain('contents: write')
    expect(workflow).not.toContain('continue-on-error: true')
  })
})
