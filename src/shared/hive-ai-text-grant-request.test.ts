import { expect, it } from 'vitest'
import { grantCommand } from './hive-ai-text-grant.test-fixture'
import { parseHiveAiTextGrantRequest } from './hive-ai-text-grant-request'

it('copies and freezes the complete signed declaration', () => {
  const result = parseHiveAiTextGrantRequest(grantCommand)
  expect(result).toEqual(grantCommand)
  expect(
    [
      result,
      result.runtime,
      result.pack,
      result.request,
      result.request.messages,
      ...result.request.messages
    ].every(Object.isFrozen)
  ).toBe(true)
})
it.each(['owner', 'costPolicy', 'reservedPoints', 'url', 'key', 'grant'])(
  'rejects authority field %s',
  (key) => {
    expect(() => parseHiveAiTextGrantRequest({ ...grantCommand, [key]: 'injected' })).toThrow(
      'hive_ai_invalid_text_grant_request'
    )
    expect(() =>
      parseHiveAiTextGrantRequest({
        ...grantCommand,
        pack: { ...grantCommand.pack, [key]: 'injected' }
      })
    ).toThrow()
  }
)
it.each(['16000', 0, 16001, 1.5])('rejects invalid Pack input limit %s', (inputLimit) => {
  expect(() =>
    parseHiveAiTextGrantRequest({ ...grantCommand, pack: { ...grantCommand.pack, inputLimit } })
  ).toThrow()
})
it('bounds the whole protected body including the envelope', () => {
  expect(() =>
    parseHiveAiTextGrantRequest({
      ...grantCommand,
      request: { ...grantCommand.request, messages: [{ role: 'user', text: '"'.repeat(8100) }] }
    })
  ).toThrow()
})
