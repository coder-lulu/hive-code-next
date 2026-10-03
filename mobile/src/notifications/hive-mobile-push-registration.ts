import * as Notifications from 'expo-notifications'
import { AppState, Platform } from 'react-native'
import type { MobileSession } from '../auth/mobile-sms-session'
import {
  loadPushNotificationsEnabled,
  subscribePushNotificationsPreference
} from '../storage/preferences'
import { getNotificationPermissionState } from './notification-permissions'
import {
  registerHiveMobilePush,
  unregisterHiveMobilePush,
  type HiveMobilePushToken
} from './hive-mobile-push-client'
import {
  publishHiveMobilePushAvailability,
  type HiveMobilePushAvailability
} from './hive-mobile-push-availability'
import {
  flushHiveMobilePushPresentationAcks,
  setHiveMobilePushPresentationAckSession
} from './hive-mobile-push-presentation-ack'

const REGISTRATION_RENEWAL_INTERVAL_MS = 6 * 60 * 60 * 1_000

type PushToken = Readonly<{ data: unknown }>
type Removable = Readonly<{ remove(): void }>

export type HiveMobilePushRegistrationDependencies = Readonly<{
  loadPreference: () => Promise<boolean>
  hasPermission: () => Promise<boolean>
  readToken: () => Promise<PushToken>
  register: (
    session: MobileSession,
    token: HiveMobilePushToken,
    signal: AbortSignal
  ) => Promise<{ readonly deliveryAvailable: boolean }>
  unregister: (session: MobileSession, signal: AbortSignal) => Promise<void>
  subscribePreference: (listener: () => void) => () => void
  subscribeToken: (listener: (token: PushToken) => void) => Removable
  subscribeAppState: (listener: (state: string) => void) => Removable
  setInterval: (listener: () => void, delay: number) => ReturnType<typeof setInterval>
  clearInterval: (timer: ReturnType<typeof setInterval>) => void
  platform: string
  development: boolean
  publishAvailability: (availability: HiveMobilePushAvailability) => void
  setPresentationSession: (session: MobileSession | null) => void
  flushPresentations: () => Promise<void>
}>

const defaultDependencies: HiveMobilePushRegistrationDependencies = {
  loadPreference: loadPushNotificationsEnabled,
  hasPermission: async () => (await getNotificationPermissionState()).granted,
  readToken: () => Notifications.getDevicePushTokenAsync(),
  register: registerHiveMobilePush,
  unregister: unregisterHiveMobilePush,
  subscribePreference: subscribePushNotificationsPreference,
  subscribeToken: (listener) => Notifications.addPushTokenListener(listener),
  subscribeAppState: (listener) => AppState.addEventListener('change', listener),
  setInterval: (listener, delay) => setInterval(listener, delay),
  clearInterval: (timer) => clearInterval(timer),
  platform: Platform.OS,
  development: typeof __DEV__ !== 'undefined' && __DEV__,
  publishAvailability: publishHiveMobilePushAvailability,
  setPresentationSession: setHiveMobilePushPresentationAckSession,
  flushPresentations: flushHiveMobilePushPresentationAcks
}

function registrationToken(
  token: PushToken,
  platform: string,
  development: boolean
): HiveMobilePushToken | null {
  if (typeof token.data !== 'string' || token.data.trim() === '') {
    return null
  }
  if (platform === 'android') {
    return { platform: 'ANDROID', token: token.data }
  }
  return platform === 'ios'
    ? {
        platform: 'IOS',
        token: token.data,
        apnsEnvironment: development ? 'SANDBOX' : 'PRODUCTION'
      }
    : null
}

export class HiveMobilePushRegistrationCoordinator {
  private session: MobileSession | null = null
  private started = false
  private operation = 0
  private controller: AbortController | null = null
  private cleanups: (() => void)[] = []

  constructor(private readonly dependencies = defaultDependencies) {}

  start(): void {
    if (this.started) {
      return
    }
    this.started = true
    const preference = this.dependencies.subscribePreference(() => this.synchronize())
    const token = this.dependencies.subscribeToken((next) => this.synchronize(next))
    const appState = this.dependencies.subscribeAppState((state) => {
      if (state === 'active') {
        this.synchronize()
      }
    })
    const timer = this.dependencies.setInterval(
      () => this.synchronize(),
      REGISTRATION_RENEWAL_INTERVAL_MS
    )
    this.cleanups = [
      preference,
      () => token.remove(),
      () => appState.remove(),
      () => {
        this.dependencies.clearInterval(timer)
      }
    ]
    if (!this.session) {
      this.dependencies.publishAvailability({ status: 'unavailable', reason: 'not_authenticated' })
    }
    this.synchronize()
  }

  stop(): void {
    this.started = false
    this.operation += 1
    this.controller?.abort()
    this.controller = null
    this.cleanups.splice(0).forEach((cleanup) => cleanup())
    this.dependencies.setPresentationSession(null)
  }

  setSession(session: MobileSession | null): void {
    const previous = this.session
    this.session = session
    this.dependencies.setPresentationSession(session)
    if (!this.started) {
      return
    }
    if (!session && previous) {
      this.dependencies.publishAvailability({ status: 'unavailable', reason: 'not_authenticated' })
      this.run((signal) => this.dependencies.unregister(previous, signal))
      return
    }
    this.synchronize()
  }

  private synchronize(pushToken?: PushToken): void {
    const session = this.session
    if (!this.started || !session) {
      return
    }
    void this.dependencies.flushPresentations().catch(() => undefined)
    this.run(
      async (signal) => {
        this.publishIfCurrent(signal, { status: 'syncing' })
        const [enabled, permitted] = await Promise.all([
          this.dependencies.loadPreference(),
          this.dependencies.hasPermission()
        ])
        if (!enabled || !permitted) {
          await this.dependencies.unregister(session, signal)
          this.publishIfCurrent(signal, {
            status: 'unavailable',
            reason: 'notifications_disabled'
          })
          return
        }
        let nativeToken = pushToken
        if (!nativeToken) {
          try {
            nativeToken = await this.dependencies.readToken()
          } catch {
            this.publishIfCurrent(signal, { status: 'unavailable', reason: 'token_unavailable' })
            return
          }
        }
        const token = registrationToken(
          nativeToken,
          this.dependencies.platform,
          this.dependencies.development
        )
        if (!token) {
          this.publishIfCurrent(signal, { status: 'unavailable', reason: 'token_unavailable' })
          return
        }
        const registration = await this.dependencies.register(session, token, signal)
        this.publishIfCurrent(
          signal,
          registration.deliveryAvailable
            ? { status: 'available' }
            : { status: 'unavailable', reason: 'cloud_unavailable' }
        )
      },
      { status: 'unavailable', reason: 'cloud_unavailable' }
    )
  }

  private publishIfCurrent(signal: AbortSignal, availability: HiveMobilePushAvailability): void {
    if (!signal.aborted) {
      this.dependencies.publishAvailability(availability)
    }
  }

  private run(
    operation: (signal: AbortSignal) => Promise<unknown>,
    failureAvailability?: HiveMobilePushAvailability
  ): void {
    const revision = ++this.operation
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    void operation(controller.signal)
      .catch(() => {
        if (failureAvailability) {
          this.publishIfCurrent(controller.signal, failureAvailability)
        }
      })
      .finally(() => {
        if (this.operation === revision) {
          this.controller = null
        }
      })
  }
}
