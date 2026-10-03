import { describe, expect, it } from 'vitest'
import {
  consumptionRange,
  consumptionPath,
  consumptionPreset,
  parseConsumptionQuery,
  parseConsumptionPage
} from './hive-ai-consumption'
const query = { ...consumptionRange(['2026-09-22', '2026-09-22']), page: 1, size: 20 }
const row = {
  gatewayRequestId: 'request_12345678901234567890',
  recordedAt: '2026-09-22T00:00:00Z',
  modelId: 'model/a',
  recordedPoints: '9007199254740993',
  inputTokens: '9223372036854775807',
  outputTokens: '0'
}
const data = {
  ...query,
  source: 'NEW_API_LOG',
  consistency: 'LIVE_PAGE',
  unit: 'POINTS',
  asOf: row.recordedAt,
  reportedTotal: '1',
  entries: [row]
}
describe('consumption boundary', () => {
  it('rejects identity fields and invalid query bounds', () => {
    for (const patch of [
      { ownerId: 'other' },
      { accessToken: 'secret' },
      { size: 51 },
      { page: 0 },
      { page: 1001 },
      { page: 1.1 },
      { from: '2026-02-30T00:00:00Z' },
      { model: '*' }
    ]) {
      expect(() => parseConsumptionQuery({ ...query, ...patch })).toThrow()
    }
    const path = consumptionPath({ ...query, model: 'model/a' })
    expect(path).toContain('model=model%2Fa')
    expect(path).not.toContain('owner')
  })
  it('uses inclusive calendar dates in UTC+08 and exclusive upper bound', () => {
    expect(query.from).toBe('2026-09-21T16:00:00Z')
    expect(query.to).toBe('2026-09-22T16:00:00Z')
    expect(consumptionRange(['2026-12-31', '2026-12-31']).to).toBe('2026-12-31T16:00:00Z')
  })
  it.each([
    ['2026-02-30', '2026-03-01'],
    ['2026-01-01', '2026-02-01'],
    ['2026-09-22', '2026-09-21']
  ])('rejects invalid dates/ranges %s %s', (from, to) => {
    expect(() => consumptionRange([from, to])).toThrow()
  })
  it('rejects wildcard model filters', () =>
    expect(() => consumptionRange(['2026-09-22', '2026-09-22'], 'model*')).toThrow())
  it('preserves exact integers and strips extra upstream fields', () => {
    expect(
      parseConsumptionPage({ ...data, entries: [{ ...row, content: 'private' }] }, query).entries
    ).toEqual([row])
  })
  it.each([42, '-1', '9223372036854775808', '01'])(
    'rejects invalid points %s',
    (recordedPoints) => {
      expect(() =>
        parseConsumptionPage({ ...data, entries: [{ ...row, recordedPoints }] }, query)
      ).toThrow()
    }
  )
  it('rejects wrong pages, model, date and settlement source', () => {
    for (const patch of [
      { page: 2 },
      { source: 'SETTLED' },
      { entries: [{ ...row, recordedAt: query.to }] }
    ]) {
      expect(() => parseConsumptionPage({ ...data, ...patch }, query)).toThrow()
    }
    expect(() => parseConsumptionPage(data, { ...query, model: 'different' })).toThrow()
  })
})
it('presets follow UTC+08 natural days across midnight, month and year boundaries', () => {
  expect(consumptionPreset(7, Date.parse('2026-01-01T16:00:00Z'))).toEqual([
    '2025-12-27',
    '2026-01-02'
  ])
  expect(consumptionPreset(1, Date.parse('2026-01-01T15:59:59Z'))).toEqual([
    '2026-01-01',
    '2026-01-01'
  ])
  expect(consumptionPreset(30, Date.parse('2024-03-01T00:00:00Z'))).toEqual([
    '2024-02-01',
    '2024-03-01'
  ])
  const range = consumptionRange(consumptionPreset(7, Date.parse('2026-09-22T00:00:00Z')))
  expect(Date.parse(range.to) - Date.parse(range.from)).toBe(7 * 86400000)
})
