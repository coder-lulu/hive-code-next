import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowNames = [
  'hourly-mac-build.yml',
  'daily-mac-build.yml',
  'adhoc-mac-build.yml',
  'dev-channel-win-build.yml'
]

function readWorkflow(name) {
  return parse(readFileSync(join(projectDir, '.github/workflows', name), 'utf8'))
}

describe('legacy dev-channel workflow retirement', () => {
  it.each(workflowNames)('%s is a guarded fail-closed stub', (name) => {
    const workflow = readWorkflow(name)
    const jobs = workflow?.jobs ?? {}
    expect(Object.keys(jobs), `${name} must retain a visible migration stub`).toEqual(['retired'])
    expect(String(jobs.retired.if)).toContain("github.repository == 'stablyai/orca'")
    const steps = jobs.retired.steps ?? []
    expect(steps).toHaveLength(1)
    expect(String(steps[0].run)).toContain('HiveCloud')
    expect(String(steps[0].run)).toContain('exit 1')
  })

  it('contains no executable GitHub installer publisher in the retired paths', () => {
    for (const name of workflowNames) {
      const source = readFileSync(join(projectDir, '.github/workflows', name), 'utf8')
      expect(source).not.toMatch(/electron-builder[^\n]*--publish\s+always/i)
      expect(source).not.toMatch(/gh\s+release\s+(?:create|upload|edit)/i)
    }
  })
})
