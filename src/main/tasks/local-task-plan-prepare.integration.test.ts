import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planPrepareFixture } from './local-task-plan-prepare.test-fixture'
import { localTaskBindingKey } from './local-task-binding-file'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'

const fixtures: Awaited<ReturnType<typeof planPrepareFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.close()))
})
async function fixture() {
  const f = await planPrepareFixture()
  fixtures.push(f)
  return f
}

describe('private Main preparation through actual HTTP, issuer and filesystem', () => {
  it('completes an unbound plan through public task cancellation after persisted intent', async () => {
    const f = await fixture()
    const result = await f.assembly.facade.cancel(f.refs.taskId, f.refs.runId)
    expect(result.status).toBe('cancelRequested')
    expect(f.task.binding).not.toBeNull()
    expect(f.task.cancel_requested).toBe(true)
    expect(f.requests.filter(({ path }) => path.endsWith('/cancel'))).toHaveLength(2)
    expect(f.requests.findIndex(({ path }) => path.endsWith('/cancel'))).toBeLessThan(
      f.requests.findIndex(({ path }) => path.endsWith('/binding'))
    )
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('binds frozen original admission once and never recursively dispatches or exposes prepare on the renderer facade', async () => {
    const f = await fixture()
    expect(await f.client.preparePlanRun(f.refs)).toEqual(f.refs)
    expect(f.task.binding!.command.workflowContext).toEqual(f.admission.workflowContext)
    expect(f.task.binding!.command.executionDeadlineAt).toBe(f.admission.executionDeadlineAt)
    expect(f.issue).toHaveBeenCalledOnce()
    expect(f.bindingCommit).toHaveBeenCalledOnce()
    expect(f.requests.some((request) => request.path.endsWith('/dispatch'))).toBe(false)
    expect(f.assembly.facade).not.toHaveProperty('preparePlanRun')
    const key = localTaskBindingKey(f.task.company_id, f.refs.runId)
    expect(
      JSON.parse(await readFile(join(f.directory, 'bindings', `${key}.intent.json`), 'utf8')).input
        .input
    ).toBe(f.admission.input)
    expect(await readdir(join(f.directory, 'bindings'))).toContain(`${key}.json`)
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('retains the exact live queued binding without another commit or dispatch', async () => {
    const f = await fixture()
    await f.client.preparePlanRun(f.refs)
    await expect(f.client.preparePlanRun(f.refs)).resolves.toEqual(f.refs)
    expect(f.issue).toHaveBeenCalledTimes(2)
    expect(f.bindingCommit).toHaveBeenCalledOnce()
  })
  it.each([
    'revokeCaller',
    'revokeWorkspace',
    'revokeEnforcement',
    'closeRuntime',
    'switchAccount',
    'revokeSession',
    'signOut',
    'revokeOwner'
  ] as const)('rejects %s during preparation', async (revoke) => {
    const f = await fixture(),
      original = f.issuer.issue.bind(f.issuer)
    f.issue.mockImplementationOnce(async (input) => {
      const binding = await original(input)
      f[revoke]()
      return binding
    })
    await expect(f.client.preparePlanRun(f.refs)).rejects.toThrow()
    expect(f.bindingCommit).not.toHaveBeenCalled()
  })
  it('refuses a foreign operation caller before service reads', async () => {
    const f = await fixture()
    await expect(
      f.assembly.preparePlanRun(f.refs, { operationCallerKey: 'service:foreign' })
    ).rejects.toThrow('FORBIDDEN')
    expect(f.requests).toEqual([])
    expect(f.issue).not.toHaveBeenCalled()
  })
  it('retains a partial issuer intent as OUTCOME_UNKNOWN after restart', async () => {
    const f = await fixture()
    f.bindingCommit.mockRejectedValueOnce(new Error('Unit DB commit failure'))
    await expect(f.client.preparePlanRun(f.refs)).rejects.toThrow('SERVICE_UNAVAILABLE')
    await f.issuer.close()
    const restarted = new LocalTaskBindingIssuer(f.issuerOptions)
    try {
      await expect(restarted.issue(f.issue.mock.calls[0][0])).rejects.toThrow('OUTCOME_UNKNOWN')
    } finally {
      await restarted.close()
    }
  })
  it('still refuses execute resolver restoration from durable files after restart', async () => {
    const f = await fixture()
    await f.client.preparePlanRun(f.refs)
    await f.issuer.close()
    const restarted = new LocalTaskBindingIssuer(f.issuerOptions)
    try {
      await expect(
        restarted.resolveBinding(
          f.task.company_id,
          f.refs.runId,
          f.caller.operationCallerKey,
          'execute'
        )
      ).rejects.toThrow('FORBIDDEN')
    } finally {
      await restarted.close()
    }
  })
})
