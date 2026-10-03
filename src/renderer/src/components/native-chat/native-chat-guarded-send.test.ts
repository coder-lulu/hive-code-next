import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const write = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-terminal-inspection', () => ({ sendRuntimePtyInputVerified: write }))
import { sendGuardedNativeChatMessage } from './native-chat-guarded-send'
import {
  cancelNativeChatPtySends,
  resetNativeChatPtySendQueuesForTests
} from './native-chat-pty-send-queue'

beforeEach(() => {
  vi.useFakeTimers()
  write.mockReset()
  write.mockResolvedValue(true)
})
afterEach(() => {
  resetNativeChatPtySendQueuesForTests()
  vi.useRealTimers()
})

it('waits for each guarded write before sending the next part, including the delayed Enter', async () => {
  let acceptClear!: (value: boolean) => void
  write.mockImplementationOnce(
    () =>
      new Promise<boolean>((accept) => {
        acceptClear = accept
      })
  )
  const handle = sendGuardedNativeChatMessage({}, 'pty', 'hello', {
    requireAgentStatus: 'sendable'
  })
  await vi.advanceTimersByTimeAsync(1000)
  expect(write).toHaveBeenCalledTimes(1)
  acceptClear(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(write.mock.calls.map((call) => call[2])).toEqual(['\x15', '\x1b[200~hello\x1b[201~'])
  await vi.advanceTimersByTimeAsync(500)
  expect(write.mock.calls.map((call) => call[2])).toEqual(['\x15', '\x1b[200~hello\x1b[201~', '\r'])
  expect(write.mock.calls.every((call) => call[4].requireAgentStatus === 'sendable')).toBe(true)
  await expect(handle.accepted).resolves.toBe(true)
})

it.each([1, 2, 3])(
  'stops and reports refusal at write %i without a raw fallback',
  async (refusedWrite) => {
    write.mockImplementation(async () => write.mock.calls.length !== refusedWrite)
    const onRejected = vi.fn()
    const handle = sendGuardedNativeChatMessage({}, 'pty', 'never run in a shell', { onRejected })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(handle.accepted).resolves.toBe(false)
    expect(write).toHaveBeenCalledTimes(refusedWrite)
    expect(onRejected).toHaveBeenCalledTimes(1)
  }
)

it('cancellation aborts pending delivery and does not send Enter or claim a rejection', async () => {
  const onRejected = vi.fn()
  const handle = sendGuardedNativeChatMessage({}, 'pty', 'hello', { onRejected })
  await vi.advanceTimersByTimeAsync(0)
  handle.cancel()
  await vi.advanceTimersByTimeAsync(1000)
  expect(write).toHaveBeenCalledTimes(2)
  expect(write.mock.calls[0][4].signal.aborted).toBe(true)
  await expect(handle.accepted).resolves.toBe(false)
  expect(onRejected).not.toHaveBeenCalled()
})

it('model-command cancellation also settles queued guarded messages', async () => {
  const first = sendGuardedNativeChatMessage({}, 'pty', 'first', {})
  const queued = sendGuardedNativeChatMessage({}, 'pty', 'queued', {})
  await vi.advanceTimersByTimeAsync(0)
  cancelNativeChatPtySends('pty')
  await vi.advanceTimersByTimeAsync(1000)
  await expect(first.accepted).resolves.toBe(false)
  await expect(queued.accepted).resolves.toBe(false)
  expect(write.mock.calls.map((call) => call[2])).toEqual(['\x15', '\x1b[200~first\x1b[201~'])
})
