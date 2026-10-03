import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createManagedPiCloudRequest } from './managed-pi-cloud-request'
import { canonicalHiveAiTextRequest } from '../../shared/hive-ai-text-request'
import { pumpManagedPiInference } from './managed-pi-inference-pump'
import type { ManagedPiProcessTransport } from '../runtime/managed-pi-process-transport'

function fixture(protocol: 'CHAT_COMPLETIONS' | 'RESPONSES' = 'CHAT_COMPLETIONS') {
  return {
    sessionId: `ha-session:${randomUUID()}`,
    generationId: `ha-generation:${randomUUID()}`,
    text: 'next question',
    history: [
      { role: 'user' as const, text: '你好' },
      { role: 'assistant' as const, text: 'answer' }
    ],
    modelSelection: { modelId: 'vendor/model', protocol, snapshotRevision: 'a'.repeat(64) },
    executionBinding: {
      schemaVersion: 1 as const,
      packRevision: 'b'.repeat(64),
      profileId: 'personal',
      protocol,
      toolPolicy: 'empty' as const,
      maxInputTokens: 16000,
      maxOutputTokens: 2000
    }
  }
}
it.each(['CHAT_COMPLETIONS', 'RESPONSES'] as const)(
  'builds the strict Cloud request for %s with a durable identity',
  (protocol) => {
    const input = fixture(protocol)
    const first = createManagedPiCloudRequest(input)
    const restored = createManagedPiCloudRequest(JSON.parse(JSON.stringify(input)))
    expect(first.requestId).toBe(input.generationId.slice('ha-generation:'.length))
    expect(canonicalHiveAiTextRequest(first)).toBe(canonicalHiveAiTextRequest(restored))
    expect(first.messages).toEqual([...input.history, { role: 'user', text: input.text }])
    expect(Object.keys(first).sort()).toEqual([
      'generationId',
      'messages',
      'modelId',
      'protocol',
      'requestId',
      'sessionId',
      'snapshotRevision'
    ])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.messages)).toBe(true)
    expect(first.messages.every(Object.isFrozen)).toBe(true)
    input.history[0].text = 'mutated'
    expect(first.messages[0].text).toBe('你好')
    const next = createManagedPiCloudRequest({
      ...input,
      generationId: `ha-generation:${randomUUID()}`
    })
    expect(next.requestId).not.toBe(first.requestId)
  }
)
it.each(['requestId', 'url', 'key', 'owner', 'messages'])(
  'rejects injected field %s instead of overriding host content',
  (field) => {
    expect(() => createManagedPiCloudRequest({ ...fixture(), [field]: 'injected' })).toThrow()
  }
)
it('keeps identity stable when content changes but changes the signed fingerprint input', () => {
  const input = fixture()
  const first = createManagedPiCloudRequest(input)
  const changed = createManagedPiCloudRequest({ ...input, text: 'different' })
  expect(first.requestId).toBe(changed.requestId)
  expect(canonicalHiveAiTextRequest(first)).not.toBe(canonicalHiveAiTextRequest(changed))
})
it('does not open the inference port when already cancelled', async () => {
  const run = vi.fn(async function* () {
    yield { type: 'completed' as const, text: '' }
  })
  await expect(
    pumpManagedPiInference({
      request: fixture(),
      signal: AbortSignal.abort(),
      transport: {} as ManagedPiProcessTransport,
      inference: { run },
      assertCurrent: () => undefined,
      timeoutMs: 1000
    })
  ).rejects.toThrow('hive_agent_outcome_unknown')
  expect(run).not.toHaveBeenCalled()
})
