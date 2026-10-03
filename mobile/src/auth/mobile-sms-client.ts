import * as SecureStore from 'expo-secure-store'
import { getRandomBytes, randomUUID } from 'expo-crypto'
import nacl from 'tweetnacl'
import { hivecodeProductConfig } from '../generated/product-config'
import { readApiJsonWithinLimit } from './mobile-api-response-body'
import { parseRelayRetryAfterMs } from '../../../src/shared/relay-retry-after-header'

const DEVICE_ID_KEY = 'hivecode.mobile.auth.device-id'
const DEVICE_PUBLIC_KEY = 'hivecode.mobile.auth.device-public-key'
const DEVICE_SECRET_KEY = 'hivecode.mobile.auth.device-secret-key'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_API_ERROR_MESSAGE_CHARACTERS = 512
const MAX_API_ERROR_CATEGORY_CHARACTERS = 256

export type DeviceIdentity = {
  readonly deviceId: string
  readonly publicKey: string
  readonly secretKey: Uint8Array
  readonly deviceLabel: string
}

type ApiEnvelope<T> = { code?: number; msg?: string; category?: string; data?: T | null }
type MobileApiRequestOptions = Readonly<{
  headers?: Record<string, string>
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  signal?: AbortSignal
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
  credentials?: RequestCredentials
  cache?: RequestCache
  redirect?: RequestRedirect
  maximumResponseBytes?: number
}>

export class MobileApiError extends Error {
  readonly status: number
  readonly category?: string
  readonly retryable: boolean

  constructor(
    message: string,
    status: number,
    category: string | undefined,
    retryable: boolean,
    readonly retryAfterMs: number | null = null
  ) {
    super(message)
    this.name = 'MobileApiError'
    this.status = status
    this.category = category
    this.retryable = retryable
  }
}

function apiBase(): string {
  const value = hivecodeProductConfig.services.api.baseUrl
  if (!value) {
    throw new Error('云端登录服务未配置')
  }
  return value.replace(/\/$/, '')
}

export function mobileApiUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('登录服务路径无效')
  }
  return `${apiBase()}${path}`
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

export async function deviceIdentity(): Promise<DeviceIdentity> {
  nacl.setPRNG((_array, length) => _array.set(getRandomBytes(length)))
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
  options: MobileApiRequestOptions = {}
): Promise<T> {
  return (await requestWithMetadata<T>(path, body, options)).value
}

export async function requestWithMetadata<T>(
  path: string,
  body: unknown,
  options: MobileApiRequestOptions = {}
): Promise<{ readonly value: T; readonly headers: Headers }> {
  let response: Response | undefined
  let payload: unknown
  let lastFailure: unknown
  const bases = [apiBase()]
  for (const base of bases) {
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    if (options.signal?.aborted) {
      abortFromCaller()
    } else {
      options.signal?.addEventListener('abort', abortFromCaller, { once: true })
    }
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      response = await (options.fetchImpl ?? fetch)(`${base}${path}`, {
        method: options.method ?? 'POST',
        cache: options.cache,
        credentials: options.credentials,
        redirect: options.redirect,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...(options.method === 'GET' || options.method === 'DELETE'
          ? {}
          : { body: JSON.stringify(body) }),
        signal: controller.signal
      })
      if (response.status === 204) {
        return { value: {} as T, headers: response.headers }
      }
      payload = await readApiJsonWithinLimit(response, options.maximumResponseBytes)
      break
    } catch (failure) {
      if (options.signal?.aborted) {
        throw failure
      }
      lastFailure = failure
      response = undefined
      payload = undefined
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abortFromCaller)
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
      isRetryableApiError(response.status, category),
      parseRelayRetryAfterMs(response.headers.get('Retry-After'), 60_000)
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
        isRetryableApiError(response.status, category),
        parseRelayRetryAfterMs(response.headers.get('Retry-After'), 60_000)
      )
    }
    if (envelope.data === null || envelope.data === undefined) {
      throw new MobileApiError('登录服务返回了无效响应', response.status, undefined, false)
    }
    return { value: envelope.data as T, headers: response.headers }
  }
  return { value: payload as T, headers: response.headers }
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
    ? payload.msg.slice(0, MAX_API_ERROR_MESSAGE_CHARACTERS)
    : '登录服务暂时不可用，请稍后再试'
}

function apiErrorCategory(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined
  }
  if (typeof payload.category === 'string') {
    return payload.category.slice(0, MAX_API_ERROR_CATEGORY_CHARACTERS)
  }
  return typeof payload.code === 'string'
    ? payload.code.slice(0, MAX_API_ERROR_CATEGORY_CHARACTERS)
    : undefined
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
