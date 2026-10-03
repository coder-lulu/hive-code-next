import { createHash, randomUUID } from 'node:crypto'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import {
  HIVE_MOBILE_PUSH_REJECTION_REASONS,
  type HiveMobilePushRejectionReason
} from '../../shared/hive-mobile-push-contract'
import type {
  MobileNotificationDispatchEvent,
  MobileNotificationRemotePushResult,
  MobileNotificationRemotePushSink,
  PreparedMobileNotificationRemotePush
} from '../runtime/runtime-mobile-notification-controller'
import {
  HiveRuntimeCloudHttpClient,
  type HiveRuntimeCloudFetch
} from './hive-runtime-cloud-http-client'
import { exactKeys, isRecord } from './hive-runtime-cloud-response'

type HiveMobilePushClientOptions = Readonly<{
  apiBaseUrl: string
  getAuthorization: () => HiveRuntimeCloudAuthorization | null
  getRuntimeId: () => string | null
  fetchImpl?: HiveRuntimeCloudFetch
}>

type PushSource = 'AGENT_TASK_COMPLETE' | 'TERMINAL_BELL' | 'PLUGIN' | 'TEST'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function isRejectionReason(value: string): value is HiveMobilePushRejectionReason {
  return HIVE_MOBILE_PUSH_REJECTION_REASONS.some((reason) => reason === value)
}

function sourceFor(event: MobileNotificationDispatchEvent): PushSource {
  switch (event.source) {
    case 'agent-task-complete':
      return 'AGENT_TASK_COMPLETE'
    case 'terminal-bell':
      return 'TERMINAL_BELL'
    case 'plugin':
      return 'PLUGIN'
    case 'test':
      return 'TEST'
  }
}

function genericBody(event: MobileNotificationDispatchEvent): string {
  if (event.source === 'test') {
    return `${APP_DISPLAY_NAME} push notifications are working`
  }
  if (event.source === 'terminal-bell') {
    return 'Terminal activity needs your attention'
  }
  if (event.source === 'plugin') {
    return `A ${APP_DISPLAY_NAME} plugin sent a notification`
  }
  if (event.agentState === 'blocked' || event.agentState === 'waiting') {
    return 'Agent needs your input'
  }
  return 'Agent task finished'
}

function idempotencyKey(runtimeId: string, notificationId: string | undefined): string {
  if (!notificationId) {
    return randomUUID()
  }
  const hex = createHash('sha256')
    .update(runtimeId)
    .update('\0')
    .update(notificationId)
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function normalizePushResult(value: unknown): MobileNotificationRemotePushResult {
  if (!isRecord(value) || typeof value.accepted !== 'boolean') {
    throw new Error('invalid_hive_mobile_push_response')
  }
  if (value.accepted) {
    exactKeys(value, ['accepted'])
    return { accepted: true }
  }
  exactKeys(value, ['accepted', 'reason'])
  if (typeof value.reason !== 'string' || !isRejectionReason(value.reason)) {
    throw new Error('invalid_hive_mobile_push_response')
  }
  return {
    accepted: false,
    reason: value.reason
  }
}

export class HiveMobilePushClient
  extends HiveRuntimeCloudHttpClient
  implements MobileNotificationRemotePushSink
{
  constructor(private readonly options: HiveMobilePushClientOptions) {
    super(options.apiBaseUrl, options.fetchImpl)
  }

  prepare(): PreparedMobileNotificationRemotePush | null {
    const authorization = this.options.getAuthorization()
    const runtimeId = this.options.getRuntimeId()
    if (!authorization || !runtimeId || !UUID_PATTERN.test(runtimeId)) {
      return null
    }
    return {
      accountId: authorization.accountId,
      send: (event) => this.sendPrepared(authorization, runtimeId, event)
    }
  }

  async send(event: MobileNotificationDispatchEvent): Promise<MobileNotificationRemotePushResult> {
    const prepared = this.prepare()
    if (!prepared) {
      return { accepted: false, reason: 'unavailable' }
    }
    return prepared.send({ ...event, accountId: prepared.accountId })
  }

  private async sendPrepared(
    authorization: HiveRuntimeCloudAuthorization,
    runtimeId: string,
    event: MobileNotificationDispatchEvent
  ): Promise<MobileNotificationRemotePushResult> {
    if (event.accountId !== authorization.accountId) {
      return { accepted: false, reason: 'unavailable' }
    }
    const deliveryId = event.deliveryId ?? randomUUID()
    const agentState =
      event.source === 'agent-task-complete'
        ? event.agentState === 'blocked' || event.agentState === 'waiting'
          ? 'NEEDS_INPUT'
          : 'FINISHED'
        : undefined
    try {
      const response = await this.request(
        '/hive/v1/mobile-push/notifications',
        {
          idempotencyKey: idempotencyKey(runtimeId, event.notificationId),
          deliveryId,
          title: APP_DISPLAY_NAME,
          body: genericBody(event),
          source: sourceFor(event),
          runtimeId,
          ...(agentState ? { agentState } : {}),
          sound: true
        },
        { authorization: `Bearer ${authorization.accessToken}` },
        [200, 202]
      )
      return normalizePushResult(response)
    } catch {
      return { accepted: false, reason: 'unavailable' }
    }
  }
}
