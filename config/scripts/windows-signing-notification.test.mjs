import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const releaseSteps = () =>
  parse(readFileSync(new URL('../../.github/workflows/release-cut.yml', import.meta.url), 'utf8'))
    .jobs.build.steps
const stepNamed = (steps, name) => steps.find((step) => step.name === name)

describe('Hive Windows signing publication boundary', () => {
  it('requires signature verification before HiveCloud publication without adding an upstream notification integration', () => {
    const steps = releaseSteps()
    const notify = stepNamed(steps, 'Notify Slack when Windows signing fails')
    const names = steps.map((step) => step.name)
    expect(notify).toBeUndefined()
    const gate = stepNamed(steps, 'Verify Windows inner binary signatures')
    const publish = stepNamed(steps, 'Publish signed Windows installer to HiveCloud object storage')
    expect(gate).toBeDefined()
    expect(publish).toBeDefined()
    expect(names.indexOf(gate.name)).toBeLessThan(names.indexOf(publish.name))
    expect(gate['continue-on-error']).toBeUndefined()
    expect(gate.env.ORCA_WINDOWS_INNER_SIGNATURE_REQUIRED).toBe('true')
    expect(gate.run).toContain('if ($policyFailure) { throw $policyFailure }')
    expect(gate.run).toContain('if ($required) { throw }')
    expect(publish.if).not.toMatch(/always\(\)|failure\(\)/)
  })
})
