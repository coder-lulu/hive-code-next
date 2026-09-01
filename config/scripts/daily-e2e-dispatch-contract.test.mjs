import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')

describe('daily desktop workflow retirement', () => {
  it('does not dispatch a release-scoped E2E run from the retired path', () => {
    const workflow = parse(
      readFileSync(join(projectDir, '.github/workflows/daily-mac-build.yml'), 'utf8')
    )
    expect(workflow.jobs).toEqual({
      retired: expect.objectContaining({
        if: "github.repository == 'stablyai/orca'"
      })
    })
    expect(JSON.stringify(workflow)).not.toContain('gh workflow run e2e.yml')
  })
})
