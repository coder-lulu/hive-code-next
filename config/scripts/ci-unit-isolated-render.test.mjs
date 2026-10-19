import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { discoverUnitFiles, UNIT_EXCLUDE } from './ci-unit-files.mjs'
import { planUnitSelection } from './ci-unit-selection.mjs'
import { NODE_RUNTIME_INCLUDE } from './vitest-node-runtime-files.mjs'

const unitTestWorkflow = parse(readFileSync('.github/workflows/unit-tests.yml', 'utf8'))
const workflow = parse(readFileSync('.github/workflows/pr.yml', 'utf8'))

describe('isolated unit render allocation', () => {
  it('runs the excluded mobile stack contract once after the first unit shard', () => {
    const file = 'config/scripts/mobile-web-app-stack-transition-render.test.mjs'
    const steps = unitTestWorkflow.jobs.test.steps
    const isolated = steps.filter((step) => step.name === 'Test isolated mobile stack transitions')
    expect(UNIT_EXCLUDE).toContain(file)
    const discovered = discoverUnitFiles()
    expect(discovered).toContain('config/scripts/pr-workflow-parallelism.test.mjs')
    expect(discovered).not.toContain(file)
    expect(NODE_RUNTIME_INCLUDE).toContain(file)
    const plan = planUnitSelection({ files: [file], changed: [], graph: {}, timings: {} })
    expect(plan.shards.filter((shard) => shard.index === 1)).toHaveLength(1)
    expect(isolated).toHaveLength(1)
    const step = isolated[0]
    expect(steps.indexOf(step)).toBeGreaterThan(steps.findIndex((s) => s.name === 'Test shard'))
    expect(step.if).toBe('matrix.shard.index == 1')
    expect(step['continue-on-error']).toBeUndefined()
    expect(step.env).toEqual({
      ORCA_BALANCE_UNIT_SHARDS: '0',
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_MOBILE_WEB_APP_DEPS_REQUIRED: '1'
    })
    expect(step.run).toBe(
      `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --maxWorkers=1 --no-file-parallelism ${file}`
    )
  })
  it('keeps the x64 mobile prefix lane', () => {
    expect(workflow.jobs.mobile_web_app['runs-on']).toBe('ubuntu-latest')
    expect(readFileSync('config/scripts/run-mobile-web-app-checks.mjs', 'utf8')).toContain(
      "'config/scripts/mobile-web-app-'"
    )
  })
})
