import { describe, expect, it } from 'vitest'
import { parseHiveAiTextControlRequest, parseHiveAiTextControlReply } from './hive-ai-text-control'
import { controlCommand, controlReply } from './hive-ai-text-control.test-fixture'
describe('real text control metadata', () => {
  const evidence = {
    ...controlReply,
    execution: {
      gatewayRequestId: '2026092212345678901234567890123456789',
      status: 'COMPLETED',
      reason: 'TERMINAL',
      usage: {
        inputTokens: '9007199254740993',
        outputTokens: '2',
        totalTokens: '9007199254740995',
        cachedInputTokens: null
      }
    }
  }
  it('preserves exact stream counters without inventing billing information', () => {
    const parsed = parseHiveAiTextControlReply(evidence, controlCommand.requestId)
    expect(parsed.execution?.usage?.inputTokens).toBe('9007199254740993')
    expect(parsed).not.toHaveProperty('billing')
    expect(Object.isFrozen(parsed.execution?.usage)).toBe(true)
  })
  it.each(['bad', '-1', '01', '1.2', '9223372036854775808', 1])(
    'rejects invalid counter %s',
    (inputTokens) => {
      expect(() =>
        parseHiveAiTextControlReply(
          {
            ...evidence,
            execution: {
              ...evidence.execution,
              usage: { ...evidence.execution.usage, inputTokens }
            }
          },
          controlCommand.requestId
        )
      ).toThrow('invalid_control_reply')
    }
  )
  it('rejects inconsistent totals, forged fees and secret fields', () => {
    for (const value of [
      { ...evidence, execution: { ...evidence.execution, key: 'SECRET' } },
      { ...evidence, execution: { ...evidence.execution, gatewayRequestId: null } },
      {
        ...evidence,
        execution: {
          ...evidence.execution,
          usage: { ...evidence.execution.usage, totalTokens: '0' }
        }
      },
      { ...evidence, billing: { actualPoints: '0' } },
      { ...evidence, billing: { state: 'SETTLED', actualPoints: '101' } },
      { ...evidence, billing: null }
    ]) {
      expect(() => parseHiveAiTextControlReply(value, controlCommand.requestId)).toThrow(
        'invalid_control_reply'
      )
    }
  })
  it('copies and freezes the request and tuple without content or credentials', () => {
    const parsed = parseHiveAiTextControlRequest(controlCommand)
    expect(parsed).toEqual(controlCommand)
    expect(parsed).not.toBe(controlCommand)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.runtime)).toBe(true)
  })
  it.each(['owner', 'modelId', 'group', 'url', 'key', 'messages'])(
    'rejects authority or content field %s',
    (field) =>
      expect(() =>
        parseHiveAiTextControlRequest({ ...controlCommand, [field]: 'SECRET_CANARY' })
      ).toThrow('invalid_control_request')
  )
  it.each([0, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe tuple epoch %s',
    (leaseEpoch) =>
      expect(() =>
        parseHiveAiTextControlRequest({
          ...controlCommand,
          runtime: { ...controlCommand.runtime, leaseEpoch }
        })
      ).toThrow('invalid_control_request')
  )
  it.each(['1-1-1-1-1', '00000000-0000-0000-0000-000000000000'])(
    'rejects noncanonical UUID %s',
    (runtimeRecordId) =>
      expect(() =>
        parseHiveAiTextControlRequest({
          ...controlCommand,
          runtime: { ...controlCommand.runtime, runtimeRecordId }
        })
      ).toThrow('invalid_control_request')
  )
  it('pins metadata replies to the originating request and rejects secrets or cancellation fiction', () => {
    expect(parseHiveAiTextControlReply(controlReply, controlCommand.requestId)).toEqual(
      controlReply
    )
    for (const bad of [
      { ...controlReply, key: 'SECRET_CANARY' },
      { ...controlReply, state: 'CANCELLED' },
      { ...controlReply, requestId: controlCommand.runtime.bootId },
      { data: controlReply }
    ]) {
      expect(() => parseHiveAiTextControlReply(bad, controlCommand.requestId)).toThrow(
        'invalid_control_reply'
      )
    }
  })
})
