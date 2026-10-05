import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTaskModelDispatchFixture } from './task-model-dispatch.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'

let directory: string
beforeEach(async () => {
  const root = resolve('logs/paperclip-development/p3/controlled-runtime/model-effects/tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'effects-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('original Task transaction at model effect initiation', () => {
  it('requires a prior durable model debit before reading credentials or initiating a request', async () => {
    const owner = await createTaskModelDispatchFixture(directory)
    const start = vi.fn()
    await expect(
      owner.store.tasks.runModelEffect(owner.binding, owner.validate, start)
    ).rejects.toThrow()
    expect(start).not.toHaveBeenCalled()
    expect(owner.store.tasks.get(owner.command)?.modelDispatchAttempts).toBeUndefined()
  })

  it('initiates a pending effect without holding the original store lock for its network lifetime', async () => {
    const owner = await createTaskModelDispatchFixture(directory)
    await owner.reserve()
    const before = owner.store.tasks.get(owner.command)
    let finish = (): void => {}
    const pending = new Promise<string>((resolve) => {
      finish = () => resolve('done')
    })
    const start = vi.fn(() => pending)
    const effect = await owner.store.tasks.runModelEffect(owner.binding, owner.validate, start)
    expect(effect.value).toBe(pending)
    await owner.store.setConversationName(owner.record.sessionId, 'No network lock')
    expect(owner.store.tasks.get(owner.command)).toEqual(before)
    finish()
    await expect(effect.value).resolves.toBe('done')
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('reads cancellation from another original store before initiating an effect', async () => {
    const owner = await createTaskModelDispatchFixture(directory)
    await owner.reserve()
    const other = await openTestAgentSessionRecordStore(directory)
    await other.tasks.requestCancellation(
      owner.command,
      'cross-store-cancel',
      TASK_TEST_NOW,
      owner.validate
    )
    const start = vi.fn()
    await expect(
      owner.store.tasks.runModelEffect(owner.binding, owner.validate, start)
    ).rejects.toThrow()
    expect(start).not.toHaveBeenCalled()
    expect(owner.store.tasks.get(owner.command)?.modelDispatchAttempts).toBe(1)
  })

  it('allows the already debited sixteenth request without admitting a seventeenth attempt', async () => {
    const owner = await createTaskModelDispatchFixture(directory)
    for (let count = 0; count < 16; count++) {
      await owner.reserve()
    }
    const start = vi.fn(() => 'sixteenth')
    await expect(
      owner.store.tasks.runModelEffect(owner.binding, owner.validate, start)
    ).resolves.toEqual({ value: 'sixteenth' })
    await expect(owner.reserve()).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' })
    expect(owner.store.tasks.get(owner.command)?.modelDispatchAttempts).toBe(16)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('refuses a rejected asynchronous grant and observes its rejection without initiating effects', async () => {
    const owner = await createTaskModelDispatchFixture(directory)
    await owner.reserve()
    const start = vi.fn()
    await expect(
      owner.store.tasks.runModelEffect(
        owner.binding,
        () => Promise.reject(new Error('late denial')),
        start
      )
    ).rejects.toThrow()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(start).not.toHaveBeenCalled()
    expect(owner.store.tasks.get(owner.command)?.modelDispatchAttempts).toBe(1)
  })

  it('retains the debit when the exact effect throws and does not initiate another request', async () => {
    const owner = await createTaskModelDispatchFixture(directory)
    await owner.reserve()
    const start = vi.fn(() => {
      throw new Error('request-initiation-failed')
    })
    await expect(
      owner.store.tasks.runModelEffect(owner.binding, owner.validate, start)
    ).rejects.toThrow('request-initiation-failed')
    expect(start).toHaveBeenCalledTimes(1)
    expect(owner.store.tasks.get(owner.command)?.modelDispatchAttempts).toBe(1)
  })

  it('refuses an unconfirmed cold owner while retaining its original debit', async () => {
    const owner = await createTaskModelDispatchFixture(directory)
    await owner.reserve()
    const cold = await openTestAgentSessionRecordStore(directory)
    const start = vi.fn()
    await expect(cold.tasks.runModelEffect(owner.binding, owner.validate, start)).rejects.toThrow()
    expect(start).not.toHaveBeenCalled()
    expect(cold.tasks.get(owner.command)?.modelDispatchAttempts).toBe(1)
  })
})
