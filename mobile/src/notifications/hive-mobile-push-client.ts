import type { MobileSession } from '../auth/mobile-sms-session'
import { isRecord, request } from '../auth/mobile-sms-client'

const REGISTRATION_PATH = '/hive/v1/mobile-push/registrations/current'
const PRESENTATION_PATH = '/hive/v1/mobile-push/notifications/presentations/current'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export type HiveMobilePushToken = Readonly<{
  platform: 'IOS' | 'ANDROID'
  token: string
  apnsEnvironment?: 'SANDBOX' | 'PRODUCTION'
}>

export type HiveMobilePushRegistration = Readonly<{
  registrationId: string
  expiresAt: number
  deliveryAvailable: boolean
}>

function authorization(session: MobileSession): Record<string, string> {
  return { Authorization: `Bearer ${session.accessToken}` }
}

function normalizeRegistration(value: unknown): HiveMobilePushRegistration {
  if (!isRecord(value) || Object.keys(value).length !== 3) {
    throw new Error('invalid_hive_mobile_push_registration')
  }
  const registrationId = value.registrationId
  const expiresAt = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : Number.NaN
  if (
    typeof registrationId !== 'string' ||
    !UUID_PATTERN.test(registrationId) ||
    !Number.isFinite(expiresAt) ||
    typeof value.deliveryAvailable !== 'boolean'
  ) {
    throw new Error('invalid_hive_mobile_push_registration')
  }
  return { registrationId, expiresAt, deliveryAvailable: value.deliveryAvailable }
}

export async function registerHiveMobilePush(
  session: MobileSession,
  pushToken: HiveMobilePushToken,
  signal?: AbortSignal
): Promise<HiveMobilePushRegistration> {
  const response = await request<unknown>(REGISTRATION_PATH, pushToken, {
    method: 'PUT',
    signal,
    headers: authorization(session)
  })
  return normalizeRegistration(response)
}

export async function unregisterHiveMobilePush(
  session: MobileSession,
  signal?: AbortSignal
): Promise<void> {
  await request(REGISTRATION_PATH, undefined, {
    method: 'DELETE',
    signal,
    headers: authorization(session)
  })
}

export async function acknowledgeHiveMobilePushPresentation(
  session: MobileSession,
  deliveryId: string
): Promise<void> {
  await request(
    PRESENTATION_PATH,
    { deliveryId },
    {
      method: 'PUT',
      headers: authorization(session)
    }
  )
}
