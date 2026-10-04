import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { handleExternalExecutionControl } from '../../integration/paperclip/service/external-execution-control.mjs'

const companyId = randomUUID(),
  runId = randomUUID(),
  taskId = randomUUID()
const context = () => ({
  repository: {
    resolveExternalExecution: vi.fn(async () => ({
      accountId: 'private-owner',
      taskId,
      companyId,
      runId
    }))
  },
  dispatch: { control: vi.fn(async () => undefined) }
})

describe('external execution observer control contract', () => {
  it.each(['recover', 'cancel', 'drain'])(
    'accepts %s only for the account derived from private storage',
    async (action) => {
      const { repository, dispatch } = context()
      expect(
        await handleExternalExecutionControl(repository, dispatch, companyId, runId, { action })
      ).toEqual({
        accepted: true,
        companyId,
        runId,
        action,
        retained: true
      })
      expect(repository.resolveExternalExecution).toHaveBeenCalledWith(companyId, runId)
      expect(dispatch.control).toHaveBeenCalledWith('private-owner', taskId, action, {
        companyId,
        runId
      })
    }
  )
  it.each([
    { action: 'start' },
    { action: 'recover', accountId: 'forged' },
    { action: 'cancel', binding: {} },
    { action: 'drain', reason: 'untrusted' },
    { action: 'recover', command: 'must-not-run' }
  ])('rejects extra authority and execution fields before reading storage: %j', async (body) => {
    const { repository, dispatch } = context()
    await expect(
      handleExternalExecutionControl(repository, dispatch, companyId, runId, body)
    ).rejects.toThrow()
    expect(repository.resolveExternalExecution).not.toHaveBeenCalled()
    expect(dispatch.control).not.toHaveBeenCalled()
  })
  it('does not acknowledge an unbound or foreign run', async () => {
    const { repository, dispatch } = context()
    repository.resolveExternalExecution.mockRejectedValue(new Error('FORBIDDEN'))
    await expect(
      handleExternalExecutionControl(repository, dispatch, companyId, runId, { action: 'recover' })
    ).rejects.toThrow('FORBIDDEN')
    expect(dispatch.control).not.toHaveBeenCalled()
  })
  it('propagates unavailable delivery while preserving the request as unresolved', async () => {
    const { repository, dispatch } = context()
    dispatch.control.mockRejectedValue(new Error('SERVICE_UNAVAILABLE'))
    await expect(
      handleExternalExecutionControl(repository, dispatch, companyId, runId, { action: 'drain' })
    ).rejects.toThrow('SERVICE_UNAVAILABLE')
  })
})
