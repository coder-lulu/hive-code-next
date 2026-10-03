import type { AiModelCandidateCatalog } from './hive-ai-model-candidates'

export const modelCandidatesFixture: AiModelCandidateCatalog = {
  snapshotRevision: 'a'.repeat(64),
  asOf: '2026-09-13T00:00:00Z',
  scope: 'REFERENCE',
  unit: 'POINTS_PER_MILLION_TOKENS',
  models: [
    {
      candidateId: `candidate-${'b'.repeat(64)}`,
      displayName: 'model-plain',
      availability: 'CANDIDATE',
      protocols: ['CHAT_COMPLETIONS', 'RESPONSES'],
      price: {
        mode: 'TOKEN_RATIO',
        input: '9007199254740993.123456789012',
        output: '0',
        cacheRead: null,
        cacheWrite: '0.000000000001'
      }
    },
    {
      candidateId: `candidate-${'c'.repeat(64)}`,
      displayName: 'model-tiered',
      availability: 'CANDIDATE',
      protocols: ['CHAT_COMPLETIONS'],
      price: { mode: 'TIERED', input: null, output: null, cacheRead: null, cacheWrite: null }
    }
  ]
}
