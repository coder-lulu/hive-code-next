import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../..')
const workflows = join(root, '.github/workflows')
const retired = [
  'cloud-deploy-relay-asia-topology.yml',
  'cloud-deploy-relay-production-same-cap.yml',
  'cloud-deploy-relay-production-same-cap-job.yml',
  'cloud-deploy-relay-production-capacity-job.yml',
  'cloud-operate-relay-asia-admission.yml',
  'cloud-operate-relay-production-cell-flags.yml',
  'cloud-operate-relay-staging-cell-flags.yml',
  'cloud-prove-relay-staging-capacity.yml'
]

describe('product Cloud workflow owners', () => {
  it('has no foreign Relay deployment/operator entry or dangling Cloud reusable workflow', () => {
    for (const name of retired) {
      expect(existsSync(join(workflows, name)), name).toBe(false)
    }
    for (const name of readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name))) {
      const body = readFileSync(join(workflows, name), 'utf8')
      const workflow = parse(body)
      expect(body, name).not.toMatch(/cloud\/apps\/relay(?:[/'"\s]|-ops)/)
      expect(body, name).not.toMatch(/dev\/scripts\/[\w-]*relay[\w-]*\.mjs/)
      for (const job of Object.values(workflow.jobs ?? {})) {
        if (job.uses?.startsWith('./.github/workflows/cloud-')) {
          expect(existsSync(join(root, job.uses)), `${name}: ${job.uses}`).toBe(true)
        }
      }
    }
  })

  it('retains the Push reference verification and repository-fenced deployment', () => {
    const verification = parse(readFileSync(join(workflows, 'cloud-verify.yml'), 'utf8'))
    expect(verification.jobs.test.env.ORCA_PUSH_TEST_DATABASE_URL).toBeTruthy()
    const deploy = parse(readFileSync(join(workflows, 'cloud-push-deploy.yml'), 'utf8'))
    expect(deploy.jobs.deploy.if).toContain("github.repository == 'stablyai/orca'")
    expect(deploy.jobs.deploy.env.SERVICE_NAME).toBe('orca-cloud-push')
  })
})
