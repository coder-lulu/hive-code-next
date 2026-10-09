import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/adhoc-mac-build.yml', 'utf8'))

describe('retired adhoc build cannot publish installers', () => {
  it('retains a manual migration response with read-only repository permissions', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual(['retired'])
    expect(workflow.jobs.retired.if).toBe("github.repository == 'stablyai/orca'")
  })

  it('fails explicitly for every requested ref instead of starting a build', () => {
    const [step] = workflow.jobs.retired.steps
    expect(workflow.jobs.retired.steps).toHaveLength(1)
    expect(step.run).toContain('::error::Adhoc GitHub installer publishing is retired.')
    expect(step.run).toContain('authenticated HiveCloud internal draft')
    expect(step.run.trim().split('\n').at(-1)).toBe('exit 1')
    expect(step.run).not.toContain('${{ inputs.')
  })

  it('has no checkout, build, artifact, release, or credential-bearing step', () => {
    const job = workflow.jobs.retired
    expect(job.secrets).toBeUndefined()
    expect(job.permissions).toBeUndefined()
    for (const step of job.steps) {
      expect(step.uses).toBeUndefined()
      expect(step.env).toBeUndefined()
      expect(step['continue-on-error']).toBeUndefined()
      expect(step.run).not.toMatch(/\b(?:pnpm|npm|gh|git|curl)\s/)
    }
  })
})
