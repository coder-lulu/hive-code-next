import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createTaskRepository } from '../../integration/paperclip/service/task-repository.mjs'
import { createTaskDispatch } from '../../integration/paperclip/service/task-dispatch.mjs'

describe('exact task run selection', () => {
  it('reads the requested attempt of one Issue rather than its first binding', async () => {
    const taskId = randomUUID(),
      firstRun = randomUUID(),
      secondRun = randomUUID()
    const first = { id: taskId, run_id: firstRun, result_receipt: { status: 'failed' } }
    const second = { id: taskId, run_id: secondRun, result_receipt: null }
    const sql = vi.fn(async (_strings, ...values) => [values.includes(secondRun) ? second : first])
    const repository = createTaskRepository(sql)
    expect(await repository.read('account:run-tests', taskId, secondRun)).toEqual(second)
    expect(await repository.read('account:run-tests', taskId, firstRun)).toEqual(first)
  })

  it('rejects an Issue-only read before accessing persisted bindings', async () => {
    const sql = vi.fn(async () => [{}])
    await expect(
      createTaskRepository(sql).read('account:run-tests', randomUUID())
    ).rejects.toThrow()
    expect(sql).not.toHaveBeenCalled()
  })

  it('keeps pending flights of different runs independent and coalesces only the same run', async () => {
    const taskId = randomUUID(),
      companyId = randomUUID(),
      firstRun = randomUUID(),
      secondRun = randomUUID()
    const pending = new Map()
    const read = vi.fn(
      (_account, _task, runId) => new Promise((resolve) => pending.set(runId, resolve))
    )
    const dispatch = createTaskDispatch({ read })
    const first = dispatch.start('account:run-tests', taskId, firstRun)
    const replay = dispatch.start('account:run-tests', taskId, firstRun)
    const second = dispatch.start('account:run-tests', taskId, secondRun)
    try {
      expect(read).toHaveBeenCalledTimes(2)
      expect(first).toBe(replay)
      expect(first).not.toBe(second)
    } finally {
      for (const [runId, resolve] of pending) {
        resolve({
          id: taskId,
          company_id: companyId,
          run_id: runId,
          result_receipt: { status: 'failed' }
        })
      }
      await Promise.allSettled([first, replay, second])
      await dispatch.close()
    }
  })
})
