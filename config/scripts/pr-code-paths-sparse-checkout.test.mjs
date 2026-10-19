import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { runProcess } from '@orca/process-host'

const project = resolve(import.meta.dirname, '../..')

it('runs PR classification with only the code_paths sparse checkout files available', async () => {
  const workflow = parse(readFileSync(join(project, '.github/workflows/pr.yml'), 'utf8'))
  const checkout = workflow.jobs.code_paths.steps.find((step) =>
    step.uses?.startsWith('actions/checkout@')
  )
  expect(checkout.with['sparse-checkout-cone-mode']).toBe(false)
  const logs = join(project, 'logs', 'pr-sparse-checkout')
  mkdirSync(logs, { recursive: true })
  const isolated = mkdtempSync(join(logs, 'test-'))
  try {
    for (const entry of checkout.with['sparse-checkout'].trim().split(/\r?\n/)) {
      if (entry.endsWith('/')) {
        continue
      }
      const relative = entry.replace(/^\//, '')
      const destination = join(isolated, relative)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(join(project, relative), destination)
    }
    const entry = pathToFileURL(join(isolated, 'config/scripts/pr-code-change-scope.mjs')).href
    const routing = pathToFileURL(join(isolated, 'config/scripts/pr-e2e-source-routing.mjs')).href
    const result = await runProcess({
      program: process.execPath,
      args: [
        '--input-type=module',
        '-e',
        `
        const { classifyPrJobs } = await import(${JSON.stringify(entry)});
        await import(${JSON.stringify(routing)});
        console.log(JSON.stringify(classifyPrJobs(['.github/workflows/pr.yml'])));
      `
      ],
      cwd: isolated,
      env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
      timeoutMs: 15_000
    })
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      should_run: true,
      static_analysis: true,
      typecheck: true
    })
  } finally {
    rmSync(isolated, { recursive: true, force: true })
  }
})
