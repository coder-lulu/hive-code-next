import { describe, expect, it } from 'vitest'
import { formatAiPrice, parseAiModelCandidates } from './hive-ai-model-candidates'
import { modelCandidatesFixture as catalog } from './hive-ai-model-candidates.test-fixture'

describe('Cloud model candidates and reference prices', () => {
  it('preserves reference scope and exact amounts without conferring call eligibility', () => {
    expect(parseAiModelCandidates(catalog)).toEqual(catalog)
    expect(formatAiPrice(catalog.models[0]!.price.input, 'en-US')).toBe(
      '9,007,199,254,740,993.123456789012'
    )
    expect(formatAiPrice('0', 'zh-CN')).toBe('0')
    expect(formatAiPrice(null, 'zh-CN')).toBe('—')
    expect(formatAiPrice('0.000000000001', 'de-DE')).toBe('0,000000000001')
  })
  it.each([
    { ...catalog, scope: 'ACCOUNT' },
    { ...catalog, snapshotRevision: `${catalog.snapshotRevision}\n` },
    { ...catalog, unit: 'USD' },
    { ...catalog, asOf: '2026-09-13T08:00:00+08:00' },
    { ...catalog, snapshotRevision: 1 },
    { ...catalog, models: Array(101).fill(catalog.models[0]) },
    { ...catalog, models: [catalog.models[0], catalog.models[0]] }
  ])('rejects incompatible scope, identifiers, or list bounds', (raw) => {
    expect(() => parseAiModelCandidates(raw)).toThrow('invalid_ai_model_response')
  })
  it.each([
    { availability: 'ACTIVE' },
    { displayName: 'model\n' },
    { candidateId: `${catalog.models[0]!.candidateId}\n` },
    { price: { ...catalog.models[0]!.price, input: '1\n' } },
    { displayName: '<script>' },
    { protocols: [] },
    { protocols: ['CHAT_COMPLETIONS', 'CHAT_COMPLETIONS'] },
    { protocols: ['UNKNOWN'] },
    { price: { ...catalog.models[0]!.price, input: 9007199254740992 } },
    { price: { ...catalog.models[0]!.price, input: null } },
    { price: { ...catalog.models[0]!.price, input: '-1' } },
    { price: { ...catalog.models[0]!.price, input: '1e3' } },
    { price: { ...catalog.models[0]!.price, input: '01' } },
    { price: { ...catalog.models[0]!.price, input: '1.00' } },
    { price: { ...catalog.models[0]!.price, input: '1'.repeat(65) } },
    { price: { ...catalog.models[1]!.price, input: '0' } }
  ])('rejects unsafe models or fabricated simple rates', (patch) => {
    expect(() =>
      parseAiModelCandidates({ ...catalog, models: [{ ...catalog.models[0], ...patch }] })
    ).toThrow('invalid_ai_model_response')
  })
  it('projects only the public fields', () => {
    const result = parseAiModelCandidates({
      ...catalog,
      secret: 'private',
      models: [{ ...catalog.models[0], channel: 'private' }]
    })
    expect(JSON.stringify(result)).not.toContain('private')
  })
})
