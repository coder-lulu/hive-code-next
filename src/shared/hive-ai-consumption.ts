export function consumptionPreset(days: 1 | 7 | 30, now = Date.now()): [string, string] {
  if (![1, 7, 30].includes(days) || !Number.isFinite(now)) {
    return invalid()
  }
  const local = now + 8 * 3600000
  return [
    new Date(local - (days - 1) * 86400000).toISOString().slice(0, 10),
    new Date(local).toISOString().slice(0, 10)
  ]
}
export type ConsumptionQuery = {
  from: string
  to: string
  page: number
  size: number
  model?: string
}
export type HiveAiConsumptionSnapshot = { accountId: string; history: ConsumptionPage }
export function parseConsumptionQuery(value: unknown): ConsumptionQuery {
  const data = object(value)
  if (Object.keys(data).some((key) => !['from', 'to', 'page', 'size', 'model'].includes(key))) {
    return invalid()
  }
  const from = timestamp(data.from)
  const to = timestamp(data.to)
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (
    !from.endsWith('Z') ||
    from.includes('.') ||
    to.includes('.') ||
    start < 1000 ||
    end <= start ||
    end - start > 31 * 86400000 ||
    new Date(start).toISOString().replace('.000Z', 'Z') !== from ||
    new Date(end).toISOString().replace('.000Z', 'Z') !== to ||
    typeof data.page !== 'number' ||
    !Number.isInteger(data.page) ||
    data.page < 1 ||
    data.page > 1000 ||
    typeof data.size !== 'number' ||
    !Number.isInteger(data.size) ||
    data.size < 1 ||
    data.size > 50 ||
    (data.model !== undefined &&
      (typeof data.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(data.model)))
  ) {
    return invalid()
  }
  return {
    from,
    to,
    page: data.page,
    size: data.size,
    ...(typeof data.model === 'string' ? { model: data.model } : {})
  }
}
export function consumptionPath(value: ConsumptionQuery): string {
  const query = parseConsumptionQuery(value)
  const params = new URLSearchParams({
    from: query.from,
    to: query.to,
    page: String(query.page),
    size: String(query.size)
  })
  if (query.model) {
    params.set('model', query.model)
  }
  return `/hive/v1/ai/consumption?${params}`
}
export type ConsumptionEntry = {
  gatewayRequestId: string
  recordedAt: string
  modelId: string
  recordedPoints: string
  inputTokens: string
  outputTokens: string
}
export type ConsumptionPage = {
  source: 'NEW_API_LOG'
  consistency: 'LIVE_PAGE'
  unit: 'POINTS'
  asOf: string
  reportedTotal: string
  entries: ConsumptionEntry[]
} & ConsumptionQuery
function invalid(): never {
  throw new Error('invalid_ai_consumption')
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid()
  }
  return value as Record<string, unknown>
}
function integer(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  ) {
    return invalid()
  }
  return value
}
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalid()
  }
  return value
}
export function consumptionRange(
  dates: string[],
  model = ''
): Omit<ConsumptionQuery, 'page' | 'size'> {
  if (dates.length !== 2 || dates.some((date) => !/^\d{4}-\d\d-\d\d$/.test(date))) {
    return invalid()
  }
  if (
    dates.some((date) => {
      const parsed = Date.parse(`${date}T00:00:00Z`)
      return !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date
    })
  ) {
    return invalid()
  }
  const start = Date.parse(`${dates[0]}T00:00:00+08:00`)
  const end = Date.parse(`${dates[1]}T00:00:00+08:00`) + 86400000
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 1000 ||
    end <= start ||
    end - start > 31 * 86400000 ||
    (model !== '' && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model))
  ) {
    return invalid()
  }
  return {
    from: new Date(start).toISOString().replace('.000Z', 'Z'),
    to: new Date(end).toISOString().replace('.000Z', 'Z'),
    ...(model ? { model } : {})
  }
}
export function parseConsumptionPage(value: unknown, query: ConsumptionQuery): ConsumptionPage {
  query = parseConsumptionQuery(query)
  const data = object(value)
  if (
    data.source !== 'NEW_API_LOG' ||
    data.consistency !== 'LIVE_PAGE' ||
    data.unit !== 'POINTS' ||
    data.from !== query.from ||
    data.to !== query.to ||
    data.page !== query.page ||
    data.size !== query.size ||
    !Array.isArray(data.entries) ||
    data.entries.length > query.size
  ) {
    return invalid()
  }
  const entries = data.entries.map((value) => {
    const row = object(value)
    if (
      typeof row.gatewayRequestId !== 'string' ||
      !/^[A-Za-z0-9_-]{24,128}$/.test(row.gatewayRequestId) ||
      typeof row.modelId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(row.modelId) ||
      (query.model && row.modelId !== query.model)
    ) {
      return invalid()
    }
    const recordedAt = timestamp(row.recordedAt)
    if (
      Date.parse(recordedAt) < Date.parse(query.from) ||
      Date.parse(recordedAt) >= Date.parse(query.to)
    ) {
      return invalid()
    }
    return {
      gatewayRequestId: row.gatewayRequestId,
      recordedAt,
      modelId: row.modelId,
      recordedPoints: integer(row.recordedPoints),
      inputTokens: integer(row.inputTokens),
      outputTokens: integer(row.outputTokens)
    }
  })
  const reportedTotal = integer(data.reportedTotal)
  if (BigInt(reportedTotal) < BigInt(entries.length)) {
    return invalid()
  }
  return {
    ...query,
    source: 'NEW_API_LOG',
    consistency: 'LIVE_PAGE',
    unit: 'POINTS',
    asOf: timestamp(data.asOf),
    reportedTotal,
    entries
  }
}
