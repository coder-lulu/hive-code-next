import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { canonicalHiveAiTextRequest, parseHiveAiTextRequest } from './hive-ai-text-request'

const request = {
  requestId: '11111111-1111-4111-8111-111111111111',
  sessionId: 'ha-session:22222222-2222-4222-8222-222222222222',
  generationId: 'ha-generation:33333333-3333-4333-8333-333333333333',
  modelId: 'vendor/model-a',
  protocol: 'CHAT_COMPLETIONS',
  snapshotRevision: 'a'.repeat(64),
  messages: [
    { role: 'system', text: 'Plain text only.' },
    { role: 'user', text: '你好' }
  ]
}
describe('W03 bound text content contract', () => {
  it.each([
    ['CHAT_COMPLETIONS', 'c5bcc212e752c400ab471e67b426c0b4781096f4098d62eebfd442a6fb8330b4'],
    ['RESPONSES', '5c558534358f5a8b1aedfe4c055baa5ce7c3d294f31d2713dfb3043f829d7e21']
  ])('matches the Cloud canonical UTF-8 fingerprint for %s', (protocol, hash) => {
    const content = {
      ...request,
      protocol,
      messages: [request.messages[0]!, { role: 'user', text: '你好\n🐝' }]
    }
    const reordered = Object.fromEntries(Object.entries(content).toReversed())
    expect(canonicalHiveAiTextRequest(reordered)).toBe(canonicalHiveAiTextRequest(content))
    expect(
      createHash('sha256').update(canonicalHiveAiTextRequest(content), 'utf8').digest('hex')
    ).toBe(hash)
    expect(() => canonicalHiveAiTextRequest({ ...content, url: 'https://untrusted.test' })).toThrow(
      'hive_ai_invalid_text_request'
    )
  })
  it.each(['CHAT_COMPLETIONS', 'RESPONSES'])(
    'accepts native protocol %s and copies conversation content',
    (protocol) => {
      const parsed = parseHiveAiTextRequest({ ...request, protocol })
      expect(parsed).toEqual({ ...request, protocol })
      parsed.messages[1]!.text = 'poison'
      expect(request.messages[1]!.text).toBe('你好')
    }
  )
  it.each([
    'owner',
    'userId',
    'url',
    'key',
    'tools',
    'options',
    'previous_response_id',
    'store',
    'outputTokens'
  ])('rejects authority and passthrough field %s', (field) =>
    expect(() => parseHiveAiTextRequest({ ...request, [field]: 'SECRET_CANARY' })).toThrow(
      /^hive_ai_invalid_text_request$/
    )
  )
  it.each([
    { ...request, requestId: '00000000-0000-0000-0000-000000000000' },
    { ...request, protocol: 'IMAGE' },
    { ...request, snapshotRevision: 'stale' },
    { ...request, generationId: request.sessionId },
    { ...request, messages: [] },
    { ...request, messages: [{ role: 'tool', text: 'x' }] },
    { ...request, messages: [{ role: 'user', text: 'x', image: 'SECRET_CANARY' }] },
    { ...request, messages: [{ role: 'assistant', text: 'x' }] },
    {
      ...request,
      messages: [
        { role: 'user', text: 'x' },
        { role: 'system', text: 'x' }
      ]
    },
    { ...request, messages: Array.from({ length: 65 }, () => ({ role: 'user', text: 'x' })) },
    ...['', ' ', '\u00a0', '\ufeff', '\u0000', '\uD800', 'x'.repeat(12001), '你'.repeat(4001)].map(
      (text) => ({
        ...request,
        messages: [{ role: 'user', text }]
      })
    ),
    { ...request, messages: [{ role: 'user', text: `${'\n'.repeat(11999)}x` }] }
  ])('rejects invalid or oversized content without reflecting it', (value) => {
    expect(() => parseHiveAiTextRequest(value)).toThrow(/^hive_ai_invalid_text_request$/)
  })
  it('uses UTF-8 bytes and total conversation limits independently', () => {
    expect(
      parseHiveAiTextRequest({ ...request, messages: [{ role: 'user', text: '你'.repeat(4000) }] })
        .messages
    ).toHaveLength(1)
    expect(() =>
      parseHiveAiTextRequest({
        ...request,
        messages: [
          { role: 'user', text: 'x'.repeat(6001) },
          { role: 'user', text: 'x'.repeat(6000) }
        ]
      })
    ).toThrow('invalid_text_request')
  })
})
