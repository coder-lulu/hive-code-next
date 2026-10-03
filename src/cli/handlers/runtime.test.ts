import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import type { RuntimeClient } from '../runtime-client'
import { RUNTIME_HANDLERS } from './runtime'

const runtimeRecordId = '123e4567-e89b-42d3-a456-426614174000'

function success(result: unknown) {
  return { id: 'request-1', ok: true as const, result, _meta: { runtimeId: 'runtime-local' } }
}

describe('runtime CLI handlers', () => {
  const call = vi.fn()
  const client = { call } as unknown as RuntimeClient
  let log: ReturnType<typeof vi.spyOn>
  let stderr: ReturnType<typeof vi.spyOn>

  function context(
    flags: Map<string, string | boolean> = new Map<string, string | boolean>(),
    json = false
  ): HandlerContext {
    return { client, cwd: process.cwd(), flags, json, rawArgs: [] }
  }

  beforeEach(() => {
    call.mockReset()
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.useRealTimers()
    log.mockRestore()
    stderr.mockRestore()
  })

  it('prints local ownership status without selecting a paired Runtime', async () => {
    call.mockResolvedValue(
      success({
        ownership: 'CLAIMED',
        presence: 'ONLINE',
        runtimeRecordId,
        relay: 'registered'
      })
    )

    await RUNTIME_HANDLERS['runtime status'](context())

    expect(call).toHaveBeenCalledWith('cloudRuntime.status')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ownership: CLAIMED'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining(runtimeRecordId))
  })

  it('shows the device code and waits for a claimed result by default', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    call
      .mockResolvedValueOnce(
        success({
          status: 'PENDING',
          runtimeRecordId,
          challengeId: '223e4567-e89b-42d3-a456-426614174000',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://hive.example/claim',
          expiresAt: 60_000,
          pollIntervalSeconds: 1
        })
      )
      .mockResolvedValueOnce(success({ status: 'CLAIMED', runtimeRecordId }))

    const pending = RUNTIME_HANDLERS['runtime claim'](context())
    await vi.advanceTimersByTimeAsync(1_000)
    await pending

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('ABCD-EFGH'))
    expect(call).toHaveBeenNthCalledWith(
      2,
      'cloudRuntime.claimPoll',
      { challengeId: '223e4567-e89b-42d3-a456-426614174000' },
      { timeoutMs: 15_000 }
    )
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Runtime claimed'))
  })

  it('does not wait or poll past the claim challenge expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    call.mockResolvedValueOnce(
      success({
        status: 'PENDING',
        runtimeRecordId,
        challengeId: '223e4567-e89b-42d3-a456-426614174000',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://hive.example/claim',
        expiresAt: 1_500,
        pollIntervalSeconds: 30
      })
    )

    const pending = RUNTIME_HANDLERS['runtime claim'](context())
    const expired = expect(pending).rejects.toThrow('Runtime claim challenge expired')
    await vi.advanceTimersByTimeAsync(500)

    await expired
    expect(call).toHaveBeenCalledOnce()
  })

  it('does not poll before the server-provided next poll time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    call
      .mockResolvedValueOnce(
        success({
          status: 'PENDING',
          runtimeRecordId,
          challengeId: '223e4567-e89b-42d3-a456-426614174000',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://hive.example/claim',
          expiresAt: 120_000,
          pollIntervalSeconds: 1
        })
      )
      .mockResolvedValueOnce(
        success({
          status: 'PENDING',
          challengeId: '223e4567-e89b-42d3-a456-426614174000',
          nextPollAt: 61_000
        })
      )
      .mockResolvedValueOnce(success({ status: 'CLAIMED', runtimeRecordId }))

    const pending = RUNTIME_HANDLERS['runtime claim'](context())
    await vi.advanceTimersByTimeAsync(1_000)
    expect(call).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(call).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(29_000)
    await pending

    expect(call).toHaveBeenCalledTimes(3)
  })

  it('confirms identity reset while leaving local pairing outside the operation', async () => {
    call.mockResolvedValue(success({ reset: true }))

    await RUNTIME_HANDLERS['runtime reset-cloud-identity'](context())

    expect(call).toHaveBeenCalledWith('cloudRuntime.resetIdentity', { confirm: true })
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Local anonymous pairing was not changed')
    )
  })

  it.each(['environment', 'pairing-code'])(
    'rejects --%s instead of managing the wrong installation',
    async (flag) => {
      await expect(
        RUNTIME_HANDLERS['runtime status'](context(new Map([[flag, 'other-host']])))
      ).rejects.toThrow('does not retarget')
      expect(call).not.toHaveBeenCalled()
    }
  )
})
