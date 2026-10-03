import { expect, it, vi } from 'vitest'
import {
  createManagedPiCloudInference,
  type ManagedPiCloudAuthority
} from './managed-pi-cloud-inference'
import { grantCommand } from '../../shared/hive-ai-text-grant.test-fixture'
import { parseHiveAiTextGrantRequest } from '../../shared/hive-ai-text-grant-request'
import { controlOwner } from '../../shared/hive-ai-text-control.test-fixture'
import type { HiveAiSignedTextGrant } from '../../shared/hive-ai-text-grant'
import type { HiveAiTextStreamResult } from '../hive-runtime-cloud/hive-ai-text-stream'
import type { HiveAiTextStreamClient } from '../hive-runtime-cloud/hive-ai-text-stream-client'
import type { ManagedPiInferenceEvent } from '../../shared/managed-pi-process-protocol'

function setup() {
  const command = parseHiveAiTextGrantRequest(grantCommand)
  const authority: ManagedPiCloudAuthority = {
    runtime: command.runtime,
    projectScope: command.projectScope,
    owner: controlOwner,
    identity: {
      schemaVersion: 1,
      runtimeInstanceId: command.runtime.runtimeInstanceId,
      privateKeyPkcs8: 'private-canary',
      publicKey: 'public',
      createdAt: 1
    },
    authorityId: 'authority',
    accessToken: 'token-canary',
    assertCurrent: vi.fn()
  }
  const grant = {} as HiveAiSignedTextGrant
  const result: HiveAiTextStreamResult = {
    type: 'result',
    requestId: command.request.requestId,
    sequence: 3,
    replay: false,
    state: 'COMPLETED',
    execution: {
      gatewayRequestId: 'a'.repeat(24),
      status: 'COMPLETED',
      reason: 'TERMINAL',
      usage: null
    }
  }
  const grants = { issue: vi.fn(async () => grant) }
  const streams = {
    execute: vi.fn(async (input: Parameters<HiveAiTextStreamClient['execute']>[0]) => {
      await input.onText('hello ')
      await input.onText('世界')
      return result
    })
  }
  const resolve = vi.fn(async () => authority)
  const abort = new AbortController()
  const input = {
    request: command.request,
    signal: abort.signal,
    executionBinding: {
      schemaVersion: 1 as const,
      ...command.pack,
      protocol: command.request.protocol,
      maxInputTokens: command.pack.inputLimit,
      maxOutputTokens: command.pack.outputLimit
    }
  }
  const { inputLimit: _, outputLimit: __, ...binding } = input.executionBinding
  const inference = createManagedPiCloudInference({ grants, streams, resolve })
  return {
    grants,
    streams,
    resolve,
    authority,
    result,
    abort,
    command,
    run: () => inference.run({ ...input, executionBinding: binding })
  }
}
async function collect(events: ReturnType<ReturnType<typeof setup>['run']>) {
  const output: ManagedPiInferenceEvent[] = []
  for await (const event of events) {
    output.push(event)
  }
  return output
}
it('issues one Grant, streams once and completes with exactly the emitted text', async () => {
  const test = setup()
  expect(await collect(test.run())).toEqual([
    { type: 'text', text: 'hello ' },
    { type: 'text', text: '世界' },
    { type: 'completed', text: 'hello 世界' }
  ])
  expect(test.grants.issue).toHaveBeenCalledOnce()
  expect(test.streams.execute).toHaveBeenCalledOnce()
  expect(test.grants.issue.mock.calls[0]).toMatchObject([
    { command: test.command, owner: controlOwner }
  ])
  expect(test.streams.execute.mock.calls[0]).toMatchObject([{ command: test.command }])
})
it.each(['FAILED', 'UNKNOWN', 'DISPATCHED', 'RECONCILED'] as const)(
  'does not complete state %s',
  async (state) => {
    const test = setup()
    Object.assign(test.result, { state })
    const events: ManagedPiInferenceEvent[] = []
    await expect(
      (async () => {
        for await (const event of test.run()) {
          events.push(event)
        }
      })()
    ).rejects.toThrow('hive_agent_outcome_unknown')
    expect(events.every((event) => event.type === 'text')).toBe(true)
    expect(test.streams.execute).toHaveBeenCalledOnce()
  }
)
it.each(['FAILED', 'CANCELLED', 'INCOMPLETE', 'UNKNOWN'] as const)(
  'does not complete execution %s',
  async (status) => {
    const test = setup()
    Object.assign(test.result.execution!, { status })
    await expect(collect(test.run())).rejects.toThrow('hive_agent_outcome_unknown')
  }
)
it('does not treat replay metadata as a fresh answer', async () => {
  const test = setup()
  test.streams.execute.mockImplementation(async () => ({
    ...test.result,
    replay: true,
    sequence: 1
  }))
  await expect(collect(test.run())).rejects.toThrow('hive_agent_outcome_unknown')
  expect(test.streams.execute).toHaveBeenCalledOnce()
})
it('does not dispatch when Grant acquisition fails', async () => {
  const test = setup()
  test.grants.issue.mockRejectedValue(new Error('private-canary'))
  await expect(collect(test.run())).rejects.toThrow(/^hive_agent_outcome_unknown$/)
  expect(test.streams.execute).not.toHaveBeenCalled()
})
it('rechecks identity after Grant returns before dispatch', async () => {
  const test = setup()
  test.grants.issue.mockImplementation(async () => {
    vi.mocked(test.authority.assertCurrent).mockImplementation(() => {
      throw new Error('revoked')
    })
    return {} as HiveAiSignedTextGrant
  })
  await expect(collect(test.run())).rejects.toThrow('hive_agent_outcome_unknown')
  expect(test.streams.execute).not.toHaveBeenCalled()
})
it('does not resolve authority for an already cancelled invocation', async () => {
  const test = setup()
  test.abort.abort()
  await expect(collect(test.run())).rejects.toThrow('hive_agent_outcome_unknown')
  expect(test.resolve).not.toHaveBeenCalled()
})
it('backpressures the producer and cancels it when the consumer stops', async () => {
  const test = setup()
  const accepted = vi.fn()
  let signal: AbortSignal | undefined
  test.streams.execute.mockImplementation(async (input) => {
    signal = input.signal
    await input.onText('first')
    accepted('first')
    await input.onText('second')
    accepted('second')
    return test.result
  })
  for await (const event of test.run()) {
    expect(event.text).toBe('first')
    break
  }
  await Promise.resolve()
  await Promise.resolve()
  expect(accepted).not.toHaveBeenCalledWith('second')
  expect(signal?.aborted).toBe(true)
})
