const DELIVERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DELIVERED_TTL_MS = 10 * 60 * 1_000
const MAX_DELIVERED_IDS = 512

type PendingEntry = {
  state: 'pending'
  createdAt: number
  settled: Promise<boolean>
  settle(delivered: boolean): void
}

type DeliveredEntry = {
  state: 'delivered'
  createdAt: number
}

type DeliveryEntry = PendingEntry | DeliveredEntry

export type NotificationDeliveryLease = Readonly<{
  commit(): void
  release(): void
}>

const deliveries = new Map<string, DeliveryEntry>()
const UNTRACKED_LEASE: NotificationDeliveryLease = {
  commit() {},
  release() {}
}

function normalizeDeliveryId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.toLowerCase()
  return DELIVERY_ID.test(normalized) ? normalized : null
}

function prune(now: number): void {
  for (const [id, entry] of deliveries) {
    if (entry.state === 'delivered' && now - entry.createdAt >= DELIVERED_TTL_MS) {
      deliveries.delete(id)
    }
  }
  if (deliveries.size <= MAX_DELIVERED_IDS) {
    return
  }
  for (const [id, entry] of deliveries) {
    if (deliveries.size <= MAX_DELIVERED_IDS) {
      return
    }
    if (entry.state === 'delivered') {
      deliveries.delete(id)
    }
  }
}

function createLease(id: string, now: number): NotificationDeliveryLease {
  let settle!: (delivered: boolean) => void
  const entry: PendingEntry = {
    state: 'pending',
    createdAt: now,
    settled: new Promise<boolean>((resolve) => {
      settle = resolve
    }),
    settle(delivered) {
      settle(delivered)
    }
  }
  deliveries.set(id, entry)
  let active = true
  return {
    commit() {
      if (!active || deliveries.get(id) !== entry) {
        return
      }
      active = false
      deliveries.set(id, { state: 'delivered', createdAt: Date.now() })
      entry.settle(true)
      prune(Date.now())
    },
    release() {
      if (!active || deliveries.get(id) !== entry) {
        return
      }
      active = false
      deliveries.delete(id)
      entry.settle(false)
    }
  }
}

/**
 * Serializes the live-RPC and native-push presentation paths for one notification.
 * A contender waits for an in-flight owner: it is suppressed after a successful
 * presentation and may take over when the first path cannot present.
 */
export async function acquireNotificationDelivery(
  value: unknown
): Promise<NotificationDeliveryLease | null> {
  const id = normalizeDeliveryId(value)
  if (!id) {
    return UNTRACKED_LEASE
  }
  for (;;) {
    const now = Date.now()
    prune(now)
    const existing = deliveries.get(id)
    if (!existing) {
      return createLease(id, now)
    }
    if (existing.state === 'delivered') {
      return null
    }
    if (await existing.settled) {
      return null
    }
  }
}

export function notificationDeliveryIdFromData(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  return normalizeDeliveryId((data as Record<string, unknown>).deliveryId)
}

export function resetNotificationDeliveryDedupeForTests(): void {
  for (const entry of deliveries.values()) {
    if (entry.state === 'pending') {
      entry.settle(false)
    }
  }
  deliveries.clear()
}
