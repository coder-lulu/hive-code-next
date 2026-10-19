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
    expect(notify).toBeUndefined()
    const gate = stepNamed(steps, 'Verify Windows inner binary signatures')
    expect(gate).toBeDefined()
    expect(
      stepNamed(steps, 'Publish signed Windows installer to HiveCloud object storage')
    ).toBeUndefined()
    expect(gate['continue-on-error']).toBeUndefined()
    expect(gate.env.ORCA_WINDOWS_INNER_SIGNATURE_REQUIRED).toBe('true')
    expect(gate.run).toContain('if ($policyFailure) { throw $policyFailure }')
    expect(gate.run).toContain('if ($required) { throw }')
    const workflow = parse(
      readFileSync(
        new URL('../../.github/workflows/hivecode-windows-hardware-sign.yml', import.meta.url),
        'utf8'
      )
    )
    const job = workflow.jobs['build-and-sign']
    const verify = stepNamed(job.steps, 'Verify final signed installer')
    const publish = stepNamed(
      job.steps,
      'Publish verified Windows installer to HiveCloud object storage'
    )
    expect(job.permissions['id-token']).toBe('write')
    expect(job.steps.indexOf(verify)).toBeLessThan(job.steps.indexOf(publish))
    expect(verify['continue-on-error']).toBeUndefined()
    expect(verify.run).toContain('pnpm run verify:windows:hardware -- $artifact')
    expect(verify.run).toContain("$signature.Status -ne 'Valid'")
    expect(publish.if).toBe("inputs.batch_id != ''")
    expect(publish.env.HIVECODE_PUBLISH).toBe("${{ inputs.batch_id != '' && 'false' || 'true' }}")
    expect(publish.env.HIVECLOUD_RELEASE_BATCH_ID).toBe('${{ inputs.batch_id }}')
    expect(stepNamed(job.steps, 'Notify Slack when Windows signing fails')).toBeUndefined()
  })
})
