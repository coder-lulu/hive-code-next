import { readFileSync } from 'node:fs'

const WORKFLOW_ROOT = new URL('../../../.github/workflows/', import.meta.url)

export function workflowFile(name) {
  return `cloud-${name}`
}

export function readWorkflow(name) {
  return readFileSync(new URL(workflowFile(name), WORKFLOW_ROOT), 'utf8').replace(/\r\n/g, '\n')
}
