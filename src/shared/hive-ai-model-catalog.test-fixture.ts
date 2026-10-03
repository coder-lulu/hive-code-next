import type { HiveAiModelCatalog, HiveAiModelSelection } from './hive-ai-model-catalog'

export const accountModelSelectionFixture: HiveAiModelSelection = {
  modelId: 'vendor/model-a',
  protocol: 'CHAT_COMPLETIONS',
  snapshotRevision: 'a'.repeat(64)
}

export const accountModelCatalogFixture: HiveAiModelCatalog = {
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
