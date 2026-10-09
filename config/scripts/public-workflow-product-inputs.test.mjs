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

it('triggers headless qualification when imported task model catalogs change', () => {
  const workflow = readWorkflow('node-server-tests.yml')
  const escape = (value) => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  const matches = (pattern, path) =>
    new RegExp(
      `^${pattern
        .split('**')
        .map((part) => part.split('*').map(escape).join('[^/]*'))
        .join('.*')}$`
    ).test(path)
  for (const event of ['push', 'pull_request']) {
    for (const input of [
      'integration/paperclip/runtime/hive-models.json',
      'integration/paperclip/runtime/catalog-provenance.json',
      'integration/paperclip/runtime/model-tools.json',
      'integration/paperclip/runtime/codex-package.json'
    ]) {
      expect(
        workflow.on[event].paths.some((pattern) => matches(pattern, input)),
        `${event} must qualify the headless runtime for ${input}`
      ).toBe(true)
    }
  }
})

it('keeps the Windows SSH checkout closure for Pi installs, task catalogs and renderer assets', () => {
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
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const preparations = [...installCommands.matchAll(/pnpm run (prepare:(?:managed|native)-pi)/g)]
  expect(preparations.map(([, script]) => script)).toEqual([
    'prepare:managed-pi',
    'prepare:native-pi'
  ])
  for (const [, script] of preparations) {
    const directory = /--dir ([^ ]+)/.exec(pkg.scripts[script])?.[1]
    expect(directory, `${script} must resolve its actual product source directory`).toBeDefined()
    for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      const input = `${directory}/${file}`
      expect(existsSync(input), `${script} input must actually exist: ${input}`).toBe(true)
      expect(covered(input), `SSH sparse checkout omits ${script} input: ${input}`).toBe(true)
    }
  }
  for (const source of [
    'src/main/tasks/task-docker-model-profile.ts',
    'src/main/tasks/task-model-response-configuration.ts',
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
      if (!input.startsWith('integration/') && !input.startsWith('mobile/')) {
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
