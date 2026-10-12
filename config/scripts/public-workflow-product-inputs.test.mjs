import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

const workflows = new URL('../../.github/workflows/', import.meta.url)
const readWorkflow = (name) => parse(readFileSync(new URL(name, workflows), 'utf8'))

it('keeps private documentation site builds out of public workflows', () => {
  const privateSiteConsumers = []
  for (const name of readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name))) {
    const workflow = readWorkflow(name)
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      const paths = [
        workflow.defaults?.run?.['working-directory'],
        job.defaults?.run?.['working-directory'],
        ...(job.steps ?? []).flatMap((step) => [
          step['working-directory'],
          step.with?.package_json_file
        ])
      ]
      if (
        paths.some((path) => typeof path === 'string' && /^\.?\/?docs\/site(?:\/|$)/.test(path))
      ) {
        privateSiteConsumers.push(`${name}:${jobId}`)
      }
    }
  }
  expect(privateSiteConsumers).toEqual([])
})

it('keeps the Windows SSH checkout closure for root dependencies and renderer assets', () => {
  const workflow = readWorkflow('ssh-windows-hosts.yml')
  const checkout = workflow.jobs.hosts.steps.find((step) =>
    step.uses?.startsWith('actions/checkout@')
  )
  const sparse = checkout.with['sparse-checkout']
    .trim()
    .split(/\r?\n/)
    .map((entry) => entry.trim())
  const covered = (file) =>
    sparse.some((directory) => file === directory || file.startsWith(`${directory}/`))
  const install = parse(
    readFileSync('.github/actions/install-node-dependencies/action.yml', 'utf8')
  )
  const installCommands = install.runs.steps.find(
    (step) => step.name === 'Install dependencies'
  ).run
  expect(installCommands).not.toMatch(/prepare:(?:managed|native)-pi/)
  for (const source of [
    'src/renderer/src/components/settings/HiveAccountSignInConfirmDialog.tsx'
  ]) {
    let requiredImports = 0
    for (const [, specifier] of readFileSync(source, 'utf8').matchAll(
      /\bfrom\s+['"]([^'"]+)['"]/g
    )) {
      if (!specifier.startsWith('.')) {
        continue
      }
      const input = relative(process.cwd(), resolve(dirname(source), specifier)).replaceAll(
        '\\',
        '/'
      )
      if (!input.startsWith('mobile/')) {
        continue
      }
      requiredImports += 1
      expect(existsSync(input), `Actual Electron build import must exist: ${input}`).toBe(true)
      expect(
        covered(input),
        `SSH sparse checkout omits actual Electron build import: ${input}`
      ).toBe(true)
    }
    expect(
      requiredImports,
      `${source} must have an actual product build dependency`
    ).toBeGreaterThan(0)
  }
})
