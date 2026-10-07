import { readFileSync, readdirSync } from 'node:fs'
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
