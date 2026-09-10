import { describe, expect, it } from 'vitest'
import { parseHiveAiModelCatalog, selectHiveAiModel } from './hive-ai-model-catalog'

const model = {
  modelId: 'model-a',
  displayName: 'Model A',
  modelRevision: 1,
  profile: 'shadow-synthetic',
  capabilities: ['text'],
  contextLimit: 4096,
  outputLimit: 128
}
const catalog = { catalogRevision: 7, models: [model, { ...model, modelId: 'model-b' }] }
const selection = {
  catalog,
  modelId: 'model-b',
  expectedModelRevision: 1,
  minimumCatalogRevision: 7,
  activeProfiles: ['shadow-synthetic'],
  generationState: null
}

describe('Hive AI model catalog', () => {
  it('selects exactly the explicit model and returns an independent projection', () => {
    const selected = selectHiveAiModel(selection)
    expect(selected.modelId).toBe('model-b')
    selected.capabilities.push('poison')
    expect(catalog.models[1]!.capabilities).toEqual(['text'])
  })
  it.each(['endpoint', 'key', 'secretRef', 'baseUrl'])(
    'rejects unexpected %s without reflecting input',
    (field) => {
      expect(() =>
        parseHiveAiModelCatalog({ ...catalog, models: [{ ...model, [field]: 'SECRET_CANARY' }] })
      ).toThrow(/^hive_ai_invalid_catalog$/)
    }
  )
  it.each([
    { ...catalog, models: [model, model] },
    { ...catalog, catalogRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...catalog, models: [{ ...model, outputLimit: 5000 }] },
    { ...catalog, models: [{ ...model, capabilities: ['text', 'text'] }] },
    { ...catalog, models: [{ ...model, displayName: 'bad\nname' }] },
    { code: 404, data: null }
  ])('rejects malformed or ambiguous projections', (value) => {
    expect(() => parseHiveAiModelCatalog(value)).toThrow('hive_ai_invalid_catalog')
  })
  it('never chooses the first model when selection is missing or disabled', () => {
    expect(() => selectHiveAiModel({ ...selection, modelId: null })).toThrow('selection_required')
    expect(() =>
      selectHiveAiModel({ ...selection, catalog: { ...catalog, models: [model] } })
    ).toThrow('model_unavailable')
    expect(() => selectHiveAiModel({ ...selection, catalog: { ...catalog, models: [] } })).toThrow(
      'model_unavailable'
    )
  })
  it.each(['PENDING', 'RUNNING', 'UNKNOWN'] as const)(
    'blocks selection while %s',
    (generationState) => {
      expect(() => selectHiveAiModel({ ...selection, generationState })).toThrow(
        'generation_not_terminal'
      )
    }
  )
  it.each(['COMPLETED', 'CANCELLED', 'FAILED'] as const)(
    'allows explicit selection after %s',
    (generationState) => {
      expect(selectHiveAiModel({ ...selection, generationState }).modelId).toBe('model-b')
    }
  )
  it('rejects stale revisions and unactivated profiles', () => {
    expect(() => selectHiveAiModel({ ...selection, minimumCatalogRevision: 8 })).toThrow(
      'stale_catalog'
    )
    expect(() => selectHiveAiModel({ ...selection, expectedModelRevision: 2 })).toThrow(
      'stale_model'
    )
    expect(() => selectHiveAiModel({ ...selection, activeProfiles: [] })).toThrow(
      'model_incompatible'
    )
  })
})
