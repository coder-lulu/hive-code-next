import { randomUUID } from 'node:crypto'
import { reserveNotificationCooldown } from '../../shared/notification-burst-cooldown'
import type { AgentStatusState } from '../../shared/agent-status-types'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import type { HiveMobilePushTestResult } from '../../shared/hive-mobile-push-contract'
import { MobileNotificationReplayBuffer } from './mobile-notification-replay'
import { notifyRuntimeListeners } from './runtime-async-boundaries'
import { getRuntimeDesktopSurface } from './runtime-desktop-surface'

export type MobileNotificationDispatchEvent = {
  type: 'notification'
  legacySocketAllowed?: boolean
  desktopAllowed?: boolean
  desktopAway?: boolean
  emittedAt?: number
  source: 'agent-task-complete' | 'terminal-bell' | 'test' | 'plugin'
  title: string
  body: string
  worktreeId?: string
  notificationId?: string
  /** Cross-channel identity shared by the live RPC event and HiveCloud native push. */
  deliveryId?: string
  /** HiveCloud account captured with the remote-push authorization before fan-out. */
  accountId?: string
  notificationSeq?: number
  notificationEpoch?: string
  // Why: background push must tell "needs input" from "finished" without re-deriving
  // it from the title. Optional and additive — old clients ignore it.
  agentState?: AgentStatusState
}

export type MobileNotificationDismissEvent = {
  type: 'dismiss'
  notificationId: string
  notificationSeq?: number
  notificationEpoch?: string
}

export type MobileNotificationEvent =
  | MobileNotificationDispatchEvent
  | MobileNotificationDismissEvent

export type MobileNotificationRemotePushResult = HiveMobilePushTestResult

export type PreparedMobileNotificationRemotePush = {
  accountId: string
  send(event: MobileNotificationDispatchEvent): Promise<MobileNotificationRemotePushResult>
}

export type MobileNotificationRemotePushSink = {
  prepare(): PreparedMobileNotificationRemotePush | null
}

export class RuntimeMobileNotificationController {
  private readonly listeners = new Set<(event: MobileNotificationEvent) => void>()
  private readonly legacyCooldown = new Map<string, number>()
  private readonly replay = new MobileNotificationReplayBuffer()
  private remotePushSink: MobileNotificationRemotePushSink | null = null

  setRemotePushSink(sink: MobileNotificationRemotePushSink | null): void {
    this.remotePushSink = sink
  }

  async testRemotePush(): Promise<MobileNotificationRemotePushResult> {
    const prepared = this.prepareRemotePush()
    if (!prepared) {
      return { accepted: false, reason: 'unavailable' }
    }
    try {
      return await prepared.send({
        type: 'notification',
        source: 'test',
        title: APP_DISPLAY_NAME,
        body: `${APP_DISPLAY_NAME} 推送通知已启用`,
        deliveryId: randomUUID(),
        accountId: prepared.accountId
      })
    } catch {
      return { accepted: false, reason: 'unavailable' }
    }
  }

  onDispatched(listener: (event: MobileNotificationEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getListenerCount(): number {
    return this.listeners.size
  }

  dispatch(event: MobileNotificationEvent): void {
    let preparedPush: PreparedMobileNotificationRemotePush | null = null
    if (event.type === 'notification') {
      preparedPush = this.prepareRemotePush()
      const { accountId: _untrustedAccountId, ...unscopedEvent } = event
      // Decide once before recording so reconnect and buffer eviction cannot reset cooldown.
      const legacySocketAllowed =
        event.desktopAllowed !== false &&
        (event.emittedAt === undefined ||
          reserveNotificationCooldown(
            this.legacyCooldown,
            event.worktreeId ?? 'global',
            event.emittedAt
          ))
      event = {
        ...unscopedEvent,
        deliveryId: event.deliveryId ?? randomUUID(),
        ...(preparedPush ? { accountId: preparedPush.accountId } : {}),
        legacySocketAllowed,
        desktopAway: getRuntimeDesktopSurface().isAwayForMobileNotifications?.()
      }
    }
    const seq = this.replay.record(event)
    const dispatchedEvent = {
      ...event,
      notificationSeq: seq,
      notificationEpoch: this.replay.epoch
    }
    notifyRuntimeListeners(
      this.listeners,
      (listener) => listener(dispatchedEvent),
      'mobile-notification'
    )
    if (dispatchedEvent.type === 'notification' && preparedPush) {
      void Promise.resolve()
        .then(() => preparedPush.send(dispatchedEvent))
        .catch(() => undefined)
    }
  }

  private prepareRemotePush(): PreparedMobileNotificationRemotePush | null {
    try {
      return this.remotePushSink?.prepare() ?? null
    } catch {
      return null
    }
  }

  getMissedSince(lastSeenSeq: number, epoch?: string) {
    return this.replay.getMissedSince(lastSeenSeq, epoch)
  }

  getEpoch(): string {
    return this.replay.epoch
  }

  dismiss(notificationId: string): void {
    this.dispatch({ type: 'dismiss', notificationId })
  }

  async dispatchPlugin(input: {
    pluginId: string
    title: string
    body?: string
  }): Promise<{ delivered: boolean }> {
    const title = `${input.pluginId}: ${input.title}`
    const body = input.body ?? ''
    let delivered = false
    try {
      delivered = getRuntimeDesktopSurface().showNotification({ title, body })
    } catch {
      // Headless runtimes still relay the notification to mobile clients.
    }
    this.dispatch({ type: 'notification', source: 'plugin', title, body })
    return { delivered }
  }
}
