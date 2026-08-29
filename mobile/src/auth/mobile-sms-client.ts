import * as SecureStore from 'expo-secure-store'
import { getRandomBytes, randomUUID } from 'expo-crypto'
import nacl from 'tweetnacl'
import { hivecodeProductConfig } from '../generated/product-config'

const DEVICE_ID_KEY = 'hivecode.mobile.auth.device-id'
const DEVICE_PUBLIC_KEY = 'hivecode.mobile.auth.device-public-key'
const DEVICE_SECRET_KEY = 'hivecode.mobile.auth.device-secret-key'
const REQUEST_TIMEOUT_MS = 15_000
const DEV_PRIMARY_TIMEOUT_MS = 3_000

export type DeviceIdentity = {
  readonly deviceId: string
  readonly publicKey: string
  readonly secretKey: Uint8Array
  readonly deviceLabel: string
}

type ApiEnvelope<T> = { code?: number; msg?: string; category?: string; data?: T | null }

export class MobileApiError extends Error {
  readonly status: number
  readonly category?: string
  readonly retryable: boolean

  constructor(message: string, status: number, category: string | undefined, retryable: boolean) {
    super(message)
    this.name = 'MobileApiError'
    this.status = status
    this.category = category
    this.retryable = retryable
  }
}

function apiBase(): string {
  const value = hivecodeProductConfig.endpoints.cloud
  if (!value) {
    throw new Error('云端登录服务未配置')
  }
  return value.replace(/\/$/, '')
}

function apiBaseCandidates(): string[] {
  const configured = apiBase()
  // The local HTTPS gateway intentionally binds to the host loopback address,
  // which the Android emulator cannot resolve through the reserved `.test`
  // domains. Development builds can therefore use the host-gateway HTTP API
  // as a transport fallback while retaining the test-domain URL as primary.
  const androidDev =
    process.env.EXPO_OS === 'android' || process.env.EXPO_PUBLIC_ANDROID_EMULATOR === '1'
  if (androidDev && process.env.NODE_ENV !== 'production') {
    return [configured, 'http://10.0.2.2:8080']
  }
  return [configured]
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function randomToken(): string {
  return encodeBase64Url(getRandomBytes(32))
}

function ensureNaclRandomness(): void {
  nacl.setPRNG((_array, length) => {
    _array.set(getRandomBytes(length))
  })
}

export async function deviceIdentity(): Promise<DeviceIdentity> {
  ensureNaclRandomness()
  const [storedId, storedPublic, storedSecret] = await Promise.all([
    SecureStore.getItemAsync(DEVICE_ID_KEY),
    SecureStore.getItemAsync(DEVICE_PUBLIC_KEY),
    SecureStore.getItemAsync(DEVICE_SECRET_KEY)
  ])
  if (storedId && storedPublic && storedSecret) {
    try {
      const secretKey = decodeBase64Url(storedSecret)
      const publicKey = decodeBase64Url(storedPublic)
      if (
        secretKey.length === nacl.sign.secretKeyLength &&
        publicKey.length === nacl.sign.publicKeyLength
      ) {
        return {
          deviceId: storedId,
          publicKey: storedPublic,
          secretKey,
          deviceLabel: 'HiveCode Mobile'
        }
      }
    } catch {}
  }

  const keyPair = nacl.sign.keyPair()
  const deviceIdValue = storedId ?? randomUUID()
  const publicKey = encodeBase64Url(keyPair.publicKey)
  const secretKey = encodeBase64Url(keyPair.secretKey)
  await Promise.all([
    SecureStore.setItemAsync(DEVICE_ID_KEY, deviceIdValue),
    SecureStore.setItemAsync(DEVICE_PUBLIC_KEY, publicKey),
    SecureStore.setItemAsync(DEVICE_SECRET_KEY, secretKey)
  ])
  return {
    deviceId: deviceIdValue,
    publicKey,
    secretKey: new Uint8Array(keyPair.secretKey),
    deviceLabel: 'HiveCode Mobile'
  }
}

export async function request<T>(
  path: string,
  body: unknown,
  options: { readonly headers?: Record<string, string> } = {}
): Promise<T> {
  let response: Response | undefined
  let payload: unknown
  let lastFailure: unknown
  const bases = apiBaseCandidates()
  for (const [index, base] of bases.entries()) {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      index === 0 && bases.length > 1 ? DEV_PRIMARY_TIMEOUT_MS : REQUEST_TIMEOUT_MS
    )
    try {
      response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...options.headers
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      if (response.status === 204) {
        return {} as T
      }
      payload = await response.json()
      break
    } catch (failure) {
      lastFailure = failure
      response = undefined
      payload = undefined
      if (index === bases.length - 1) {
        const timedOut = failure instanceof Error && failure.name === 'AbortError'
        throw new MobileApiError(
          timedOut ? '登录服务响应超时，请重试' : '登录服务暂时不可用，请稍后再试',
          timedOut ? 408 : 0,
          undefined,
          true
        )
      }
    } finally {
      clearTimeout(timeout)
    }
  }
  if (!response) {
    const timedOut = lastFailure instanceof Error && lastFailure.name === 'AbortError'
    throw new MobileApiError(
      timedOut ? '登录服务响应超时，请重试' : '登录服务暂时不可用，请稍后再试',
      timedOut ? 408 : 0,
      undefined,
      true
    )
  }
  if (!response.ok) {
    const category = apiErrorCategory(payload)
    throw new MobileApiError(
      apiErrorMessage(payload),
      response.status,
      category,
      isRetryableApiError(response.status, category)
    )
  }
  if (isRecord(payload) && typeof payload.code === 'number') {
    const envelope = payload as ApiEnvelope<T>
    if (envelope.code !== 200 && envelope.code !== 201) {
      const category = apiErrorCategory(envelope)
      throw new MobileApiError(
        apiErrorMessage(envelope),
        response.status,
        category,
        isRetryableApiError(response.status, category)
      )
    }
    if (envelope.data === null || envelope.data === undefined) {
      throw new MobileApiError('登录服务返回了无效响应', response.status, undefined, false)
    }
    return envelope.data as T
  }
  return payload as T
}

function apiErrorMessage(payload: unknown): string {
  const category = apiErrorCategory(payload)
  const categoryMessage =
    category === 'hive.sms_authentication.invalid_code'
      ? '验证码错误，请重试'
      : category === 'hive.sms_authentication.rate_limited'
        ? '请求过于频繁，请稍后再试'
        : category === 'hive.sms_authentication.not_verified'
          ? '验证码校验已失效，请重新获取'
          : category === 'hive.sms_authentication.identity_provider_rejected'
            ? '登录服务暂时不可用，请稍后再试'
            : category === 'hive.sms_authentication.unavailable'
              ? '登录服务暂时不可用，请稍后再试'
              : undefined
  if (categoryMessage) {
    return categoryMessage
  }
  return isRecord(payload) && typeof payload.msg === 'string'
    ? payload.msg
    : '登录服务暂时不可用，请稍后再试'
}

function apiErrorCategory(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined
  }
  if (typeof payload.category === 'string') {
    return payload.category
  }
  return typeof payload.code === 'string' ? payload.code : undefined
}

function isRetryableApiError(status: number, category: string | undefined): boolean {
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return true
  }
  return (
    category === 'hive.sms_authentication.unavailable' ||
    category === 'hive.sms_authentication.identity_provider_rejected' ||
    category === 'session_refresh_service_unavailable'
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
