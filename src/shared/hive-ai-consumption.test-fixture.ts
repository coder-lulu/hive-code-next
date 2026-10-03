import type { ConsumptionPage, ConsumptionQuery } from './hive-ai-consumption'
export const consumptionQueryFixture: ConsumptionQuery = {
  from: '2026-09-21T16:00:00Z',
  to: '2026-09-22T16:00:00Z',
  page: 1,
  size: 20
}
export const consumptionPageFixture: ConsumptionPage = {
  ...consumptionQueryFixture,
  source: 'NEW_API_LOG',
  consistency: 'LIVE_PAGE',
  unit: 'POINTS',
  asOf: '2026-09-22T00:00:00Z',
  reportedTotal: '1',
  entries: [
    {
      gatewayRequestId: 'request_12345678901234567890',
      recordedAt: '2026-09-22T00:00:00Z',
      modelId: 'model/a',
      recordedPoints: '9007199254740993',
      inputTokens: '9223372036854775807',
      outputTokens: '0'
    }
  ]
}
