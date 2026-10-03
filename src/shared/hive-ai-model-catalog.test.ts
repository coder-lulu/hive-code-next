import { describe, expect, it } from 'vitest'
import { parseHiveAiModelCatalog, selectHiveAiModel } from './hive-ai-model-catalog'

const catalog = {
  snapshotRevision: 'a'.repeat(64),
  asOf: '2026-09-14T06:00:00Z',
  scope: 'ACCOUNT',
  models: [
    {
      modelId: 'vendor/model-a',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      protocols: ['CHAT_COMPLETIONS']
    },
    {
      modelId: 'model-b',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      protocols: ['CHAT_COMPLETIONS', 'RESPONSES']
    }
  ]
}
const selection = {
  catalog,
  modelId: 'model-b',
  protocol: 'RESPONSES',
  expectedSnapshotRevision: catalog.snapshotRevision,
  generationState: null
}
describe('current-account Hive AI model catalog', () => {
  it('represents unknown limits explicitly and rejects inconsistent or unsafe limits', () => {
    const model = catalog.models[0]
    expect(
      parseHiveAiModelCatalog({
        ...catalog,
        models: [{ ...model, contextWindow: null, maxOutputTokens: null }]
      }).models[0].contextWindow
    ).toBeNull()
    for (const limits of [
      { contextWindow: null, maxOutputTokens: 4096 },
      { contextWindow: 1000, maxOutputTokens: 1000 },
      { contextWindow: 0, maxOutputTokens: 1 },
      { contextWindow: 200000.5, maxOutputTokens: 4096 },
      { contextWindow: 2147483648, maxOutputTokens: 4096 }
    ]) {
      expect(() =>
        parseHiveAiModelCatalog({ ...catalog, models: [{ ...model, ...limits }] })
      ).toThrow('hive_ai_invalid_catalog')
    }
  })
  it('selects exactly the explicit model and protocol from the exact snapshot', () => {
    expect(selectHiveAiModel(selection)).toEqual({
      modelId: 'model-b',
      protocol: 'RESPONSES',
      snapshotRevision: catalog.snapshotRevision
    })
    const parsed = parseHiveAiModelCatalog(catalog)
    parsed.models[0]!.protocols.push('RESPONSES')
    expect(catalog.models[0]!.protocols).toEqual(['CHAT_COMPLETIONS'])
  })
  it.each(['endpoint', 'key', 'secretRef', 'baseUrl', 'profile', 'contextLimit'])(
    'rejects unexpected field %s without reflecting input',
    (field) => {
      expect(() =>
        parseHiveAiModelCatalog({
          ...catalog,
          models: [{ ...catalog.models[0], [field]: 'SECRET_CANARY' }]
        })
      ).toThrow(/^hive_ai_invalid_catalog$/)
    }
  )
  it.each([
    { ...catalog, scope: 'REFERENCE' },
    { ...catalog, snapshotRevision: '1' },
    { ...catalog, asOf: 'invalid' },
    { ...catalog, models: [catalog.models[0], catalog.models[0]] },
    {
      ...catalog,
      models: [
        {
          modelId: 'bad\nname',
          contextWindow: 200000,
          maxOutputTokens: 8192,
          protocols: ['RESPONSES']
        }
      ]
    },
    {
      ...catalog,
      models: [{ modelId: 'model', contextWindow: 200000, maxOutputTokens: 8192, protocols: [] }]
    },
    {
      ...catalog,
      models: [
        {
          modelId: 'model',
          contextWindow: 200000,
          maxOutputTokens: 8192,
          protocols: ['RESPONSES', 'RESPONSES']
        }
      ]
    },
    {
      ...catalog,
      models: [
        { modelId: 'model', contextWindow: 200000, maxOutputTokens: 8192, protocols: ['IMAGE'] }
      ]
    },
    {
      ...catalog,
      models: Array.from({ length: 101 }, (_, i) => ({
        modelId: `model-${i}`,
        protocols: ['RESPONSES']
      }))
    }
  ])('rejects malformed catalogs without fallback', (value) => {
    expect(() => parseHiveAiModelCatalog(value)).toThrow(/^hive_ai_invalid_catalog$/)
  })
  it('permits an empty authoritative range', () => {
    expect(parseHiveAiModelCatalog({ ...catalog, models: [] }).models).toEqual([])
  })
  it('requires explicit selection, current models, a declared protocol and exact snapshot', () => {
    expect(() => selectHiveAiModel({ ...selection, modelId: null })).toThrow('selection_required')
    expect(() => selectHiveAiModel({ ...selection, modelId: 'removed' })).toThrow(
      'model_unavailable'
    )
    expect(() => selectHiveAiModel({ ...selection, modelId: 'vendor/model-a' })).toThrow(
      'model_incompatible'
    )
    expect(() =>
      selectHiveAiModel({ ...selection, expectedSnapshotRevision: 'b'.repeat(64) })
    ).toThrow('stale_catalog')
  })
  it.each(['PENDING', 'RUNNING', 'UNKNOWN'])(
    'prevents changing nonterminal generation %s',
    (generationState) => {
      expect(() => selectHiveAiModel({ ...selection, generationState })).toThrow(
        'generation_not_terminal'
      )
    }
  )
})
