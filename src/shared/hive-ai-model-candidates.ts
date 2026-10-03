import { formatAiInteger } from './hive-ai-account'

export type AiPricingMode = 'TOKEN_RATIO' | 'TIERED' | 'UNAVAILABLE'
export type AiModelPrice = {
  mode: AiPricingMode
  input: string | null
  output: string | null
  cacheRead: string | null
  cacheWrite: string | null
}
export type AiModelCandidate = {
  candidateId: string
  displayName: string
  availability: 'CANDIDATE'
  protocols: ('CHAT_COMPLETIONS' | 'RESPONSES')[]
  price: AiModelPrice
}
export type AiModelCandidateCatalog = {
  snapshotRevision: string
  asOf: string
  scope: 'REFERENCE'
  unit: 'POINTS_PER_MILLION_TOKENS'
  models: AiModelCandidate[]
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_ai_model_response')
  }
  return value as Record<string, unknown>
}
function amount(value: unknown): string | null {
  if (value === null) {
    return null
  }
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    value.trim() !== value ||
    !/^(0|[1-9]\d*)(\.\d*[1-9])?$/.test(value)
  ) {
    throw new Error('invalid_ai_model_response')
  }
  return value
}
export function parseAiModelCandidates(value: unknown): AiModelCandidateCatalog {
  const data = object(value)
  if (
    typeof data.snapshotRevision !== 'string' ||
    data.snapshotRevision.trim() !== data.snapshotRevision ||
    !/^[a-f0-9]{64}$/.test(data.snapshotRevision) ||
    typeof data.asOf !== 'string' ||
    data.asOf.trim() !== data.asOf ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(data.asOf) ||
    !Number.isFinite(Date.parse(data.asOf)) ||
    data.scope !== 'REFERENCE' ||
    data.unit !== 'POINTS_PER_MILLION_TOKENS' ||
    !Array.isArray(data.models) ||
    data.models.length > 100
  ) {
    throw new Error('invalid_ai_model_response')
  }
  const ids = new Set<string>()
  const models = data.models.map((raw): AiModelCandidate => {
    const model = object(raw)
    if (
      typeof model.candidateId !== 'string' ||
      model.candidateId.trim() !== model.candidateId ||
      !/^candidate-[a-f0-9]{64}$/.test(model.candidateId) ||
      ids.has(model.candidateId) ||
      typeof model.displayName !== 'string' ||
      model.displayName.trim() !== model.displayName ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model.displayName) ||
      model.availability !== 'CANDIDATE' ||
      !Array.isArray(model.protocols) ||
      model.protocols.length < 1 ||
      model.protocols.length > 2 ||
      new Set(model.protocols).size !== model.protocols.length ||
      model.protocols.some(
        (protocol) => protocol !== 'CHAT_COMPLETIONS' && protocol !== 'RESPONSES'
      )
    ) {
      throw new Error('invalid_ai_model_response')
    }
    ids.add(model.candidateId)
    const rawPrice = object(model.price)
    const mode = rawPrice.mode
    if (mode !== 'TOKEN_RATIO' && mode !== 'TIERED' && mode !== 'UNAVAILABLE') {
      throw new Error('invalid_ai_model_response')
    }
    const price: AiModelPrice = {
      mode,
      input: amount(rawPrice.input),
      output: amount(rawPrice.output),
      cacheRead: amount(rawPrice.cacheRead),
      cacheWrite: amount(rawPrice.cacheWrite)
    }
    if (
      mode === 'TOKEN_RATIO'
        ? price.input === null || price.output === null
        : [price.input, price.output, price.cacheRead, price.cacheWrite].some(
            (rate) => rate !== null
          )
    ) {
      throw new Error('invalid_ai_model_response')
    }
    return {
      candidateId: model.candidateId,
      displayName: model.displayName,
      availability: 'CANDIDATE',
      protocols: model.protocols as AiModelCandidate['protocols'],
      price
    }
  })
  return {
    snapshotRevision: data.snapshotRevision,
    asOf: data.asOf,
    scope: 'REFERENCE',
    unit: 'POINTS_PER_MILLION_TOKENS',
    models
  }
}

/** Group only the integer portion. Never round a decimal price through Number. */
export function formatAiPrice(value: string | null, locale: string): string {
  if (value === null) {
    return '—'
  }
  const [integer, fraction] = value.split('.')
  const formatted = formatAiInteger(integer!, locale)
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')
      ?.value ?? '.'
  return fraction ? `${formatted}${separator}${fraction}` : formatted
}

export type HiveAiModelCandidatesSnapshot = {
  accountId: string
  catalog: AiModelCandidateCatalog
}
