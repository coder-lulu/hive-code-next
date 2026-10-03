export type AiAccountStatus = 'NOT_PROVISIONED' | 'PENDING' | 'ACTIVE' | 'UNKNOWN' | 'DISABLED'
export const AI_BENEFITS_MAXIMUM_RESPONSE_BYTES = 128 * 1024
export type AiAccount = {
  status: AiAccountStatus
  activationAvailable: boolean
  asOf: string
}
export type AiBalance = {
  accountStatus: AiAccountStatus
  availableQuota: string | null
  usedQuota: string | null
  requestCount: string | null
  unit: 'POINTS'
  asOf: string | null
  freshness: 'CURRENT' | 'UNAVAILABLE'
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_ai_account_response')
  }
  return value as Record<string, unknown>
}
function status(value: unknown): AiAccountStatus {
  if (
    typeof value !== 'string' ||
    !['NOT_PROVISIONED', 'PENDING', 'ACTIVE', 'UNKNOWN', 'DISABLED'].includes(value)
  ) {
    throw new Error('invalid_ai_account_response')
  }
  return value as AiAccountStatus
}
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error('invalid_ai_account_response')
  }
  return value
}
function integer(value: unknown, signed = false): string {
  if (
    typeof value !== 'string' ||
    !/^(0|-?[1-9]\d{0,18})$/.test(value) ||
    BigInt(value) < (signed ? -9223372036854775808n : 0n) ||
    BigInt(value) > 9223372036854775807n
  ) {
    throw new Error('invalid_ai_account_response')
  }
  return value
}
export function parseAiAccount(value: unknown): AiAccount {
  const data = object(value)
  if (typeof data.activationAvailable !== 'boolean') {
    throw new Error('invalid_ai_account_response')
  }
  return {
    status: status(data.status),
    activationAvailable: data.activationAvailable,
    asOf: timestamp(data.asOf)
  }
}
export function parseAiBalance(value: unknown): AiBalance {
  const data = object(value)
  const accountStatus = status(data.accountStatus)
  if (data.unit !== 'POINTS') {
    throw new Error('invalid_ai_account_response')
  }
  if (
    data.freshness === 'UNAVAILABLE' &&
    data.availableQuota === null &&
    data.usedQuota === null &&
    data.requestCount === null &&
    data.asOf === null
  ) {
    return {
      accountStatus,
      availableQuota: null,
      usedQuota: null,
      requestCount: null,
      unit: 'POINTS',
      asOf: null,
      freshness: 'UNAVAILABLE'
    }
  }
  if (data.freshness !== 'CURRENT' || accountStatus !== 'ACTIVE') {
    throw new Error('invalid_ai_account_response')
  }
  return {
    accountStatus,
    availableQuota: integer(data.availableQuota, true),
    usedQuota: integer(data.usedQuota),
    requestCount: integer(data.requestCount),
    unit: 'POINTS',
    asOf: timestamp(data.asOf),
    freshness: 'CURRENT'
  }
}

export function formatAiInteger(value: string | null | undefined, locale: string): string {
  if (value == null) {
    return '—'
  }
  const formatter = new Intl.NumberFormat(locale)
  const negative = value.startsWith('-')
  const digits = negative ? value.slice(1) : value
  if (digits.length <= 15) {
    return formatter.format(Number(value))
  }

  // Hermes on Android cannot pass BigInt to NumberFormat; infer grouping from an exact safe integer.
  const localizedDigits = Array.from({ length: 10 }, (_, digit) => formatter.format(digit))
  const gaps = formatter.format(111111111111111).split(localizedDigits[1]!)
  const groups = gaps
    .slice(1, -1)
    .flatMap((gap, index) => (gap ? [{ after: index + 1, separator: gap }] : []))
  const last = groups.at(-1)
  const previous = groups.at(-2)
  const separator = last?.separator ?? ''
  let groupSize = last ? 15 - last.after : digits.length
  const repeatedGroupSize = previous && last ? last.after - previous.after : groupSize
  const chunks: string[] = []
  for (let end = digits.length; end > 0; groupSize = repeatedGroupSize) {
    const start = Math.max(0, end - groupSize)
    chunks.unshift(
      Array.from(digits.slice(start, end), (digit) => localizedDigits[Number(digit)]).join('')
    )
    end = start
  }
  const formatted = chunks.join(separator)
  if (!negative) {
    return formatted
  }
  const negativeOne = formatter.format(-1)
  const oneIndex = negativeOne.indexOf(localizedDigits[1]!)
  return oneIndex === -1
    ? `-${formatted}`
    : `${negativeOne.slice(0, oneIndex)}${formatted}${negativeOne.slice(oneIndex + localizedDigits[1]!.length)}`
}

export type HiveAiAccountSnapshot = {
  accountId: string
  account: AiAccount
  balance: AiBalance | null
}

export type AiSubscription = {
  id: string
  planId: string
  title: string | null
  status: 'active' | 'expired' | 'cancelled'
  totalPoints: string | null
  usedPoints: string
  remainingPoints: string | null
  unlimited: boolean
  expiresAt: string | null
  resetsAt: string | null
}
export type AiBenefits = {
  accountStatus: AiAccountStatus
  group: string | null
  groupFreshness: 'CURRENT' | 'UNAVAILABLE'
  subscriptions: AiSubscription[] | null
  subscriptionsFreshness: 'CURRENT' | 'UNAVAILABLE'
  unit: 'POINTS'
  asOf: string | null
}
export type HiveAiBenefitsSnapshot = {
  accountId: string
  account: AiAccount
  benefits: AiBenefits | null
}

export function parseAiBenefits(value: unknown): AiBenefits {
  const data = object(value)
  const accountStatus = status(data.accountStatus)
  const groupCurrent = data.groupFreshness === 'CURRENT'
  const plansCurrent = data.subscriptionsFreshness === 'CURRENT'
  if (
    data.unit !== 'POINTS' ||
    !['CURRENT', 'UNAVAILABLE'].includes(String(data.groupFreshness)) ||
    !['CURRENT', 'UNAVAILABLE'].includes(String(data.subscriptionsFreshness)) ||
    (groupCurrent
      ? typeof data.group !== 'string' || !data.group || data.group.length > 128
      : data.group !== null) ||
    (plansCurrent
      ? !Array.isArray(data.subscriptions) || data.subscriptions.length > 100
      : data.subscriptions !== null) ||
    (accountStatus !== 'ACTIVE' && (groupCurrent || plansCurrent))
  ) {
    throw new Error('invalid_ai_account_response')
  }
  const ids = new Set<string>()
  const subscriptions =
    data.subscriptions === null
      ? null
      : (data.subscriptions as unknown[]).map((value) => {
          const sub = object(value)
          const id = integer(sub.id),
            planId = integer(sub.planId),
            usedPoints = integer(sub.usedPoints)
          if (
            id === '0' ||
            planId === '0' ||
            ids.has(id) ||
            !['active', 'expired', 'cancelled'].includes(String(sub.status)) ||
            (sub.title !== null && (typeof sub.title !== 'string' || sub.title.length > 128)) ||
            typeof sub.unlimited !== 'boolean'
          ) {
            throw new Error('invalid_ai_account_response')
          }
          ids.add(id)
          const unlimited = sub.unlimited
          const totalPoints = unlimited ? null : integer(sub.totalPoints)
          const remainingPoints = unlimited ? null : integer(sub.remainingPoints)
          if (
            unlimited
              ? sub.totalPoints !== null || sub.remainingPoints !== null
              : totalPoints === '0' ||
                BigInt(remainingPoints!) !==
                  (BigInt(totalPoints!) > BigInt(usedPoints)
                    ? BigInt(totalPoints!) - BigInt(usedPoints)
                    : 0n)
          ) {
            throw new Error('invalid_ai_account_response')
          }
          return {
            id,
            planId,
            title: sub.title as string | null,
            status: sub.status as AiSubscription['status'],
            totalPoints,
            usedPoints,
            remainingPoints,
            unlimited,
            expiresAt: sub.expiresAt === null ? null : timestamp(sub.expiresAt),
            resetsAt: sub.resetsAt === null ? null : timestamp(sub.resetsAt)
          }
        })
  const asOf = groupCurrent || plansCurrent ? timestamp(data.asOf) : null
  if (!groupCurrent && !plansCurrent && data.asOf !== null) {
    throw new Error('invalid_ai_account_response')
  }
  return {
    accountStatus,
    group: data.group as string | null,
    groupFreshness: data.groupFreshness as AiBenefits['groupFreshness'],
    subscriptions,
    subscriptionsFreshness: data.subscriptionsFreshness as AiBenefits['subscriptionsFreshness'],
    unit: 'POINTS',
    asOf
  }
}
