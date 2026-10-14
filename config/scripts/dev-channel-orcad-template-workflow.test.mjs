import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

describe.each([
  'hourly-mac-build.yml',
  'daily-mac-build.yml',
  'adhoc-mac-build.yml',
  'dev-channel-win-build.yml'
])('%s retirement', (name) => {
  const workflow = parse(
    readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8')
  )
  it('exposes only a manual fail-closed retirement notice without build or publish authority', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual(['retired'])
    const job = workflow.jobs.retired
    expect(job.secrets).toBeUndefined()
    expect(job['continue-on-error']).toBeUndefined()
    expect(job.steps).toHaveLength(1)
    expect(job.steps[0].uses).toBeUndefined()
    expect(job.steps[0].run).toContain('::error::')
    expect(job.steps[0].run).toContain('HiveCloud')
    expect(job.steps[0].run.trim()).toMatch(/exit 1$/)
  })
})
