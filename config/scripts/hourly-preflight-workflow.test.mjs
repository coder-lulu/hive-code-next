import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { runProcess } from '../../src/shared/child-process/run-process'

const workflow = parse(
  readFileSync(new URL('../../.github/workflows/hourly-mac-build.yml', import.meta.url), 'utf8')
)

describe('retired hourly build preflight', () => {
  it('cannot allocate a Mac, install dependencies, or publish from a scheduled run', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual(['retired'])
    expect(workflow.jobs.retired.if).toBe("github.repository == 'stablyai/orca'")
    expect(workflow.jobs.retired['runs-on']).toBe('ubuntu-latest')
    expect(workflow.jobs.retired.steps).toHaveLength(1)
    expect(workflow.jobs.retired.steps[0].uses).toBeUndefined()
  })

  it('keeps the explicit retirement error and failing exit in the dispatched step', () => {
    const script = workflow.jobs.retired.steps[0].run
    expect(script).toContain('::error::')
    expect(script).toContain('HiveCloud OSS')
    expect(script).toMatch(/\bexit 1\b/)
  })

  it.runIf(process.platform !== 'win32').each(['true', 'false'])(
    'fails closed even when force is %s',
    async (forced) => {
      const result = await runProcess({
        program: 'bash',
        args: ['-c', workflow.jobs.retired.steps[0].run],
        env: { ...process.env, FORCED: forced }
      })
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('::error::')
      expect(result.stdout).toContain('retired')
      expect(result.stdout).toContain('HiveCloud OSS')
    }
  )
})
