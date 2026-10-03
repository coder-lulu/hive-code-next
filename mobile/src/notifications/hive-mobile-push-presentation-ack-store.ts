import { PRODUCT_STORAGE_NAMESPACE } from '../product-brand'

const STORAGE_KEY = `${PRODUCT_STORAGE_NAMESPACE}.mobile-push.presentation-acks.v1`
const DELIVERY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DEVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PENDING_TTL_MS = 25 * 60 * 60 * 1_000
const MAX_PENDING_ACKS_PER_ACCOUNT_DEVICE = 512
const MAX_PENDING_ACKS = 4_096

export type PendingAck = Readonly<{
  accountId: string
  deviceId: string
  deliveryId: string
  presentedAt: number
}>

export type PresentationAckStorage = Readonly<{
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}>

export function normalizeDeliveryId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.toLowerCase()
  return DELIVERY_ID_PATTERN.test(normalized) ? normalized : null
}

export function normalizeDeviceId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.toLowerCase()
  return DEVICE_ID_PATTERN.test(normalized) ? normalized : null
}

export function normalizeAccountId(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 128 ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f
    })
  ) {
    return null
  }
  return value
}

function boundPendingByAccountDevice(pending: readonly PendingAck[]): PendingAck[] {
  const retainedByScope = new Map<string, number>()
  const bounded: PendingAck[] = []
  for (let index = pending.length - 1; index >= 0; index--) {
    const entry = pending[index]
    const scope = `${entry.accountId}\u0000${entry.deviceId}`
    const retained = retainedByScope.get(scope) ?? 0
    if (retained >= MAX_PENDING_ACKS_PER_ACCOUNT_DEVICE) {
      continue
    }
    retainedByScope.set(scope, retained + 1)
    bounded.unshift(entry)
  }
  return bounded
}

function boundPending(pending: readonly PendingAck[]): PendingAck[] {
  const scoped = boundPendingByAccountDevice(pending)
  const excess = scoped.length - MAX_PENDING_ACKS
  if (excess <= 0) {
    return scoped
  }
  const indexesToDrop = new Set(
    scoped
      .map((entry, index) => ({ index, presentedAt: entry.presentedAt }))
      .sort((left, right) => left.presentedAt - right.presentedAt || left.index - right.index)
      .slice(0, excess)
      .map(({ index }) => index)
  )
  return scoped.filter((_entry, index) => !indexesToDrop.has(index))
}

export class PendingAckStore {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly storage: PresentationAckStorage) {}

  enqueue(
    accountId: string,
    deviceId: string,
    deliveryId: string,
    presentedAt: number
  ): Promise<void> {
    return this.serialized(async () => {
      const pending = (await this.read(presentedAt)).filter(
        (entry) =>
          entry.accountId !== accountId ||
          entry.deviceId !== deviceId ||
          entry.deliveryId !== deliveryId
      )
      pending.push({ accountId, deviceId, deliveryId, presentedAt })
      await this.write(boundPending(pending))
    })
  }

  list(accountId: string, deviceId: string, now: number): Promise<readonly PendingAck[]> {
    return this.serialized(async () =>
      (await this.read(now)).filter(
        (entry) => entry.accountId === accountId && entry.deviceId === deviceId
      )
    )
  }

  remove(
    accountId: string,
    deviceId: string,
    deliveryIds: ReadonlySet<string>,
    now: number
  ): Promise<void> {
    return this.serialized(async () => {
      const pending = await this.read(now)
      const next = pending.filter(
        (entry) =>
          entry.accountId !== accountId ||
          entry.deviceId !== deviceId ||
          !deliveryIds.has(entry.deliveryId)
      )
      if (next.length !== pending.length) {
        await this.write(next)
      }
    })
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.catch(() => undefined)
    return result
  }

  private async read(now: number): Promise<PendingAck[]> {
    const raw = await this.storage.getItem(STORAGE_KEY)
    if (raw === null) {
      return []
    }
    const parsed = parsePendingState(raw)
    if (!parsed) {
      await this.write([])
      return []
    }
    const active = boundPending(parsed.filter((entry) => now - entry.presentedAt < PENDING_TTL_MS))
    if (active.length !== parsed.length) {
      await this.write(active)
    }
    return active
  }

  private write(pending: readonly PendingAck[]): Promise<void> {
    return this.storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 2, pending }))
  }
}

function parsePendingState(raw: string): PendingAck[] | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isUnknownRecord(value)) {
      return null
    }
    if (value.schemaVersion !== 2 || !Array.isArray(value.pending)) {
      return null
    }
    const byDeliveryId = new Map<string, PendingAck>()
    for (const candidate of value.pending) {
      if (!isUnknownRecord(candidate)) {
        return null
      }
      const accountId = normalizeAccountId(candidate.accountId)
      const deviceId = normalizeDeviceId(candidate.deviceId)
      const deliveryId = normalizeDeliveryId(candidate.deliveryId)
      if (
        accountId &&
        deviceId &&
        deliveryId &&
        typeof candidate.presentedAt === 'number' &&
        Number.isSafeInteger(candidate.presentedAt) &&
        candidate.presentedAt >= 0
      ) {
        const pending = {
          accountId,
          deviceId,
          deliveryId,
          presentedAt: candidate.presentedAt
        }
        const key = `${pending.accountId}\u0000${deviceId}\u0000${deliveryId}`
        byDeliveryId.delete(key)
        byDeliveryId.set(key, pending)
      } else {
        return null
      }
    }
    return [...byDeliveryId.values()]
  } catch {
    return null
  }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
