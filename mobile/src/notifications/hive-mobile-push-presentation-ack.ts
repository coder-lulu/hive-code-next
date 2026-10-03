import AsyncStorage from '@react-native-async-storage/async-storage'
import type { MobileSession } from '../auth/mobile-sms-session'
import {
  normalizeAccountId,
  normalizeDeliveryId,
  normalizeDeviceId,
  PendingAckStore,
  type PendingAck,
  type PresentationAckStorage
} from './hive-mobile-push-presentation-ack-store'

const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 60_000

type RetryTimer = ReturnType<typeof setTimeout>

export type HiveMobilePushPresentationAckDependencies = Readonly<{
  storage: PresentationAckStorage
  acknowledge: (session: MobileSession, deliveryId: string) => Promise<void>
  scheduleRetry: (listener: () => void, delay: number) => RetryTimer
  cancelRetry: (timer: RetryTimer) => void
  loadStoredSession: () => Promise<MobileSession | null>
  now: () => number
}>

const defaultDependencies: HiveMobilePushPresentationAckDependencies = {
  storage: AsyncStorage,
  acknowledge: async (session, deliveryId) => {
    const { acknowledgeHiveMobilePushPresentation } = await import('./hive-mobile-push-client')
    await acknowledgeHiveMobilePushPresentation(session, deliveryId)
  },
  scheduleRetry: (listener, delay) => setTimeout(listener, delay),
  cancelRetry: (timer) => clearTimeout(timer),
  loadStoredSession: async () => {
    const { loadStoredMobileSession } = await import('../auth/mobile-sms-session')
    return loadStoredMobileSession()
  },
  now: Date.now
}

function minimumRetryDelayMs(failure: unknown): number {
  return failure && typeof failure === 'object' && 'status' in failure && failure.status === 429
    ? MAX_RETRY_DELAY_MS
    : 0
}

async function deviceIdFromSession(session: MobileSession): Promise<string | null> {
  try {
    const { decodeAccessTokenClaims } = await import('../auth/mobile-sms-session')
    return normalizeDeviceId(decodeAccessTokenClaims(session.accessToken)?.deviceId)
  } catch {
    return null
  }
}

export class HiveMobilePushPresentationAckCoordinator {
  private readonly store: PendingAckStore
  private session: MobileSession | null = null
  private flushPromise: Promise<void> | null = null
  private flushAgain = false
  private retryTimer: RetryTimer | null = null
  private retryDelayMs = INITIAL_RETRY_DELAY_MS

  constructor(private readonly dependencies = defaultDependencies) {
    this.store = new PendingAckStore(dependencies.storage)
  }

  setSession(session: MobileSession | null): void {
    this.cancelScheduledRetry()
    this.retryDelayMs = INITIAL_RETRY_DELAY_MS
    this.session = session
    if (session) {
      void this.flush()
    }
  }

  async record(deliveryValue: unknown, accountValue: unknown): Promise<void> {
    const deliveryId = normalizeDeliveryId(deliveryValue)
    const accountId = normalizeAccountId(accountValue)
    if (!deliveryId || !accountId) {
      return
    }
    const session = this.session ?? (await this.dependencies.loadStoredSession().catch(() => null))
    if (!session || session.account.accountId !== accountId) {
      return
    }
    const deviceId = await deviceIdFromSession(session)
    if (!deviceId) {
      return
    }
    try {
      await this.store.enqueue(accountId, deviceId, deliveryId, this.dependencies.now())
    } catch {
      return
    }
    void this.flushRespectingBackoff()
  }

  flush(): Promise<void> {
    if (!this.session) {
      return Promise.resolve()
    }
    this.cancelScheduledRetry()
    return this.startFlush()
  }

  private flushRespectingBackoff(): Promise<void> {
    return this.retryTimer === null ? this.startFlush() : Promise.resolve()
  }

  private startFlush(): Promise<void> {
    if (!this.session) {
      return Promise.resolve()
    }
    this.flushAgain = true
    if (this.flushPromise) {
      return this.flushPromise
    }
    let blocked = false
    const running = (async () => {
      while (this.flushAgain && !blocked && this.session) {
        this.flushAgain = false
        const session = this.session
        const retryDelay = await this.flushCurrentSession()
        blocked = retryDelay !== null
        if (retryDelay !== null && this.session === session) {
          this.scheduleRetry(session, retryDelay)
        }
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        this.flushPromise = null
        if (!blocked) {
          this.retryDelayMs = INITIAL_RETRY_DELAY_MS
        }
        if (this.flushAgain && this.session && (!blocked || this.retryTimer === null)) {
          void this.flushRespectingBackoff()
        }
      })
    this.flushPromise = running
    return running
  }

  private scheduleRetry(session: MobileSession, minimumDelay: number): void {
    if (this.retryTimer !== null || this.session !== session) {
      return
    }
    const delay = Math.max(this.retryDelayMs, minimumDelay)
    this.retryDelayMs = Math.min(delay * 2, MAX_RETRY_DELAY_MS)
    let timer!: RetryTimer
    timer = this.dependencies.scheduleRetry(() => {
      if (this.retryTimer !== timer) {
        return
      }
      this.retryTimer = null
      if (this.session === session) {
        void this.flushRespectingBackoff()
      }
    }, delay)
    this.retryTimer = timer
  }

  private cancelScheduledRetry(): void {
    if (this.retryTimer === null) {
      return
    }
    this.dependencies.cancelRetry(this.retryTimer)
    this.retryTimer = null
  }

  private async flushCurrentSession(): Promise<number | null> {
    const session = this.session
    if (!session) {
      return null
    }
    const accountId = session.account.accountId
    const deviceId = await deviceIdFromSession(session)
    if (!deviceId) {
      return null
    }
    let pending: readonly PendingAck[]
    try {
      pending = await this.store.list(accountId, deviceId, this.dependencies.now())
    } catch (failure) {
      return this.session === session ? minimumRetryDelayMs(failure) : null
    }
    const acknowledged = new Set<string>()
    for (const entry of pending) {
      try {
        await this.dependencies.acknowledge(session, entry.deliveryId)
      } catch (failure) {
        if (acknowledged.size > 0) {
          await this.store
            .remove(accountId, deviceId, acknowledged, this.dependencies.now())
            .catch(() => undefined)
        }
        if (this.session !== session) {
          this.flushAgain = true
          return null
        }
        return minimumRetryDelayMs(failure)
      }
      acknowledged.add(entry.deliveryId)
      if (this.session !== session) {
        this.flushAgain = true
        break
      }
    }
    if (acknowledged.size === 0) {
      return null
    }
    try {
      await this.store.remove(accountId, deviceId, acknowledged, this.dependencies.now())
      return null
    } catch (failure) {
      return this.session === session ? minimumRetryDelayMs(failure) : null
    }
  }
}

const presentationAcks = new HiveMobilePushPresentationAckCoordinator()

export function recordHiveMobilePushPresentationAck(
  deliveryId: unknown,
  accountId: unknown
): Promise<void> {
  return presentationAcks.record(deliveryId, accountId)
}

export function setHiveMobilePushPresentationAckSession(session: MobileSession | null): void {
  presentationAcks.setSession(session)
}

export function flushHiveMobilePushPresentationAcks(): Promise<void> {
  return presentationAcks.flush()
}
