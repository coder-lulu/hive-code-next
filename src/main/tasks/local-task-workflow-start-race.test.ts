import { afterEach, describe, expect, it, vi } from 'vitest'
import { workflowStartRaceFixture } from './local-task-workflow-start-race.test-fixture'

const fixtures: Awaited<ReturnType<typeof workflowStartRaceFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.close()))
  vi.restoreAllMocks()
})
async function fixture() {
  const f = await workflowStartRaceFixture()
  fixtures.push(f)
  return f
}

describe('foreground start and automatic original preparation', () => {
  it('returns the original admitted Run when foreground binds while automatic issue waits', async () => {
    const f = await fixture(),
      hold = f.holdIssue()
    const automatic = f.dispatch.recover()
    await hold.issued.promise
    const starting = f.facade.startWorkflowCase(f.admission.run.startRequest)
    const settled = starting.then(
      (run) => ({ run }),
      (error) => ({ error })
    )
    await f.joined.promise
    expect(f.bindingWrite).toHaveBeenCalledOnce()
    const committed = structuredClone(f.task.binding)
    hold.release.resolve()
    expect(await settled).toEqual({ run: f.admission.run })
    await automatic
    await f.delivered.promise
    expect(f.task.binding).toEqual(committed)
    expect(f.issue).toHaveBeenCalledTimes(2)
    expect(f.bindingWrite).toHaveBeenCalledOnce()
    expect(f.repository.claimDispatch).toHaveBeenCalledOnce()
    expect(f.execute).toHaveBeenCalledOnce()
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('reuses the original binding when automatic start completes before foreground joins', async () => {
    const f = await fixture(),
      hold = f.holdIssue()
    const starting = f.facade.startWorkflowCase(f.admission.run.startRequest)
    const settled = starting.then(
      (run) => ({ run }),
      (error) => ({ error })
    )
    await hold.issued.promise
    await f.dispatch.recover()
    await f.delivered.promise
    const committed = structuredClone(f.task.binding)
    hold.release.resolve()
    expect(await settled).toEqual({ run: f.admission.run })
    expect(f.task.binding).toEqual(committed)
    expect(f.bindingWrite).toHaveBeenCalledOnce()
    expect(f.repository.claimDispatch).toHaveBeenCalledOnce()
    expect(f.execute).toHaveBeenCalledOnce()
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('accepts the exact queued binding when another original preparation commits before entry', async () => {
    const f = await fixture()
    await f.client.prepareCaseRun(f.refs)
    const committed = structuredClone(f.task.binding)
    await expect(f.client.prepareCaseRun(f.refs)).resolves.toEqual(f.refs)
    expect(f.task.binding).toEqual(committed)
    expect(f.bindingWrite).toHaveBeenCalledOnce()
    expect(f.bindingCommit).toHaveBeenCalledOnce()
    expect(f.execute).not.toHaveBeenCalled()
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('handles foreground binding before the automatic flight enters Main preparation', async () => {
    const f = await fixture(),
      hold = f.holdPreparationEntry()
    const automatic = f.dispatch.recover()
    await hold.entered.promise
    const starting = f.facade.startWorkflowCase(f.admission.run.startRequest)
    const settled = starting.then(
      (run) => ({ run }),
      (error) => ({ error })
    )
    await f.joined.promise
    const committed = structuredClone(f.task.binding)
    hold.release.resolve()
    expect(await settled).toEqual({ run: f.admission.run })
    await automatic
    await f.delivered.promise
    expect(f.task.binding).toEqual(committed)
    expect(f.bindingWrite).toHaveBeenCalledOnce()
    expect(f.repository.claimDispatch).toHaveBeenCalledOnce()
    expect(f.execute).toHaveBeenCalledOnce()
    expect(f.unavailable).not.toHaveBeenCalled()
  })
})
