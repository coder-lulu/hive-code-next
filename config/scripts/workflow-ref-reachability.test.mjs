import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { runProcess } from '../../src/shared/child-process/run-process'
import { resolveGitBashPath } from '../../src/main/git-bash'

const retiredNames = ['adhoc-mac-build', 'daily-mac-build', 'dev-channel-win-build']
const readWorkflow = (name) => parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'))

describe('retired workflow ref boundary', () => {
  it.each(retiredNames)('%s cannot fetch, sign, or publish any supplied ref', (name) => {
    const workflow = readWorkflow(name)
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual(['retired'])
    const job = workflow.jobs.retired
    expect(job.if).toBe("github.repository == 'stablyai/orca'")
    expect(job['runs-on']).toBe('ubuntu-latest')
    expect(job.steps).toHaveLength(1)
    expect(Object.keys(job.steps[0]).sort()).toEqual(['name', 'run'])
    expect(job.steps[0].run.trim().split('\n')).toHaveLength(2)
    expect(job.steps[0].run).toMatch(/^echo "::error::/u)
    expect(job.steps[0].run).not.toContain('${{')
    expect(job.steps[0].run).not.toMatch(/\b(?:git |gh |pnpm |secrets\.)/u)
  })

  it.each(retiredNames)('%s rejects stale callers with a migration error', async (name) => {
    // A bare bash on Windows can resolve to the WSL launcher instead of a local POSIX shell.
    const bashProgram = process.platform === 'win32' ? resolveGitBashPath() : 'bash'
    if (!bashProgram) {
      throw new Error(
        'Git Bash is required to execute retired workflow rejection fixtures on Windows'
      )
    }
    const result = await runProcess({
      program: bashProgram,
      args: ['-c', readWorkflow(name).jobs.retired.steps[0].run],
      env: { ...process.env, REQUESTED_REF: 'refs/heads/Main', INPUT_REF: 'refs/heads/main' }
    })
    expect(result.code, result.stderr).toBe(1)
    expect(result.stdout).toContain('::error::')
    expect(result.stdout).toContain('retired')
    expect(result.stdout).toContain('HiveCloud')
  })
})
