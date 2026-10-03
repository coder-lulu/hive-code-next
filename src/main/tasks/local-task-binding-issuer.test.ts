import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { taskTestDirectory, TASK_TEST_NOW, taskCommand } from './task-execution.test-fixture'
import { createLocalTaskAuthorizer } from './local-task-authority'

let root = ''
let issuer: LocalTaskBindingIssuer | undefined
afterEach(async () => {
  await issuer?.close()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  root = await taskTestDirectory()
  const path = join(root, 'source')
  await mkdir(path)
  await writeFile(join(path, 'untracked.txt'), 'user content')
  let account = {
    accountId: 'account',
    authorityId: 'authority',
    sessionGeneration: 1,
    accessToken: 'private',
    sessionExpiresAt: TASK_TEST_NOW + 120_000
  }
  const currentAccount = () => account
  const currentRuntime = () => ({
    accountId: 'account',
    runtimeRecordId: 'runtime:one',
    ownershipEpoch: 1
  })
  const registerWorkspace = vi.fn(async () => ({
    workspaceId: 'folder:isolated',
    assertCurrent: () => undefined
  }))
  const options = {
    directory: join(root, 'tasks'),
    operationCallerKey: 'trusted-local:runtime',
    currentAccount,
    currentRuntime,
    resolveSource: async () => ({ path, assertCurrent: () => undefined }),
    registerWorkspace,
    now: () => TASK_TEST_NOW
  }
  issuer = new LocalTaskBindingIssuer(options)
  const input = {
    paperclipCompanyId: 'company:one',
    paperclipAgentId: 'agent:codex',
    task: taskCommand().task,
    workspaceSelector: 'id:user-workspace',
    input: 'Write report.md.'
  }
  const authorize = createLocalTaskAuthorizer({
    currentAccount,
    currentRuntime,
    resolveGrant: issuer.resolveGrant,
    now: () => TASK_TEST_NOW
  })
  return {
    issuer,
    input,
    registerWorkspace,
    authorize,
    restart: () => {
      issuer = new LocalTaskBindingIssuer(options)
      return issuer
    },
    switchAccount: () => {
      account = { ...account, accountId: 'other' }
    }
  }
}
describe('trusted task binding issuer', () => {
  it('coalesces concurrent preparation into one copy and stable binding', async () => {
    const h = await fixture()
    const [first, second] = await Promise.all([h.issuer.issue(h.input), h.issuer.issue(h.input)])
    expect(second).toEqual(first)
    expect(h.registerWorkspace).toHaveBeenCalledTimes(1)
    const grant = await h.authorize(
      { operationCallerKey: 'trusted-local:runtime' },
      first.command,
      'start'
    )
    expect(grant.workspace.executionPath).not.toBe(grant.workspace.canonicalPath)
    expect(grant.input).toContain(first.command.executionId)
  })
  it('rejects changing task input under the same run before another workspace is created', async () => {
    const h = await fixture()
    await h.issuer.issue(h.input)
    await expect(h.issuer.issue({ ...h.input, input: 'Other work' })).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
    expect(h.registerWorkspace).toHaveBeenCalledTimes(1)
  })
  it('revokes both issued and pending authorizations after switching account', async () => {
    const h = await fixture()
    const binding = await h.issuer.issue(h.input)
    const grant = await h.authorize(
      { operationCallerKey: 'trusted-local:runtime' },
      binding.command,
      'start'
    )
    h.switchAccount()
    expect(grant.assertCurrent).toThrow('FORBIDDEN')
    await expect(
      h.issuer.resolveBinding(
        h.input.paperclipCompanyId,
        h.input.task.runId,
        'trusted-local:runtime'
      )
    ).rejects.toThrow('FORBIDDEN')
  })
  it('never remints an execution from persisted intent after a restart', async () => {
    const h = await fixture()
    await h.issuer.issue(h.input)
    await h.issuer.close()
    const fresh = h.restart()
    await expect(fresh.issue(h.input)).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(h.registerWorkspace).toHaveBeenCalledTimes(1)
  })
})
