/* eslint-disable max-lines -- Keeps session persistence, refresh, and account-security mutations on one audited boundary. */
import * as SecureStore from 'expo-secure-store'
import { request, randomToken, isRecord, MobileApiError } from './mobile-sms-client'

export type MobileSession = {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
  readonly sessionExpiresAt: number
  readonly sessionProfile: 'TEMPORARY' | 'TRUSTED' | 'LEGACY'
  readonly account: { readonly accountId: string; readonly displayName: string }
  readonly authorityId: string
}

export type MobileAccountSecurity = {
  readonly accountId: string
  readonly userName: string
  readonly displayName: string
  readonly phoneNumber: string | null
  readonly phoneBound: boolean
}

export type MobileAccountSecurityChallenge = {
  readonly challengeId: string
  readonly bindingId: string
  readonly expiresInSeconds: number
  readonly resendAfterSeconds: number
}

export function isTerminalMobileSessionError(failure: unknown): boolean {
  if (failure instanceof Error && failure.message === '登录服务返回了无效会话') {
    return true
  }
  if (!(failure instanceof MobileApiError)) {
    return false
  }
  return (
    failure.category === 'session_refresh_rejected' ||
    failure.category === 'session_refresh_replay_detected' ||
    failure.category === 'session_refresh_credential_rejected' ||
    (failure.status === 401 && !failure.retryable)
  )
}

function requireText(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message)
  }
  return value
}

export function parseSession(value: unknown): MobileSession {
  if (!isRecord(value) || !isRecord(value.account)) {
    throw new Error('登录服务返回了无效会话')
  }
  const accessToken = requireText(value.accessToken, '登录服务返回了无效会话')
  const refreshToken = requireText(value.refreshToken, '登录服务返回了无效会话')
  const expiresAt = Date.parse(requireText(value.expiresAt, '登录服务返回了无效会话'))
  const sessionExpiresAt = Date.parse(requireText(value.sessionExpiresAt, '登录服务返回了无效会话'))
  const sessionProfile = value.sessionProfile
  const accountId = requireText(value.account.accountId, '登录服务返回了无效会话')
  const displayName = requireText(value.account.displayName, '登录服务返回了无效会话')
  const authorityId = requireText(value.authorityId, '登录服务返回了无效会话')
  if (
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(sessionExpiresAt) ||
    sessionExpiresAt <= expiresAt
  ) {
    throw new Error('登录服务返回了无效会话')
  }
  if (
    sessionProfile !== 'TEMPORARY' &&
    sessionProfile !== 'TRUSTED' &&
    sessionProfile !== 'LEGACY'
  ) {
    throw new Error('登录服务返回了无效会话')
  }
  return {
    accessToken,
    refreshToken,
    expiresAt,
    sessionExpiresAt,
    sessionProfile,
    account: { accountId, displayName },
    authorityId
  }
}

function decodeAccessTokenClaims(accessToken: string): {
  readonly sessionId: string
  readonly sessionSecurityVersion: number
  readonly deviceId?: string
  readonly deviceSecurityVersion?: number
} | null {
  try {
    const parts = accessToken.split('.')
    if (parts.length !== 3) {
      return null
    }
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])))
    if (!isRecord(payload)) {
      return null
    }
    const sessionId = payload.session_id
    const version = payload.session_security_version
    const deviceId = payload.device_id
    const deviceVersion = payload.device_security_version
    if (
      typeof sessionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        sessionId
      ) ||
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version < 0
    ) {
      return null
    }
    if (
      typeof deviceId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId) &&
      typeof deviceVersion === 'number' &&
      Number.isSafeInteger(deviceVersion) &&
      deviceVersion >= 0
    ) {
      return {
        sessionId,
        sessionSecurityVersion: version,
        deviceId,
        deviceSecurityVersion: deviceVersion
      }
    }
    return { sessionId, sessionSecurityVersion: version }
  } catch {
    return null
  }
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

const SESSION_KEY = 'hivecode.mobile.auth.session'
const ACCESS_TOKEN_KEY = 'hivecode.mobile.auth.access-token'
const REFRESH_TOKEN_KEY = 'hivecode.mobile.auth.refresh-token'
const mobileSessionInvalidationListeners = new Set<() => void>()

export function subscribeMobileSessionInvalidation(listener: () => void): () => void {
  mobileSessionInvalidationListeners.add(listener)
  return () => mobileSessionInvalidationListeners.delete(listener)
}

function notifyMobileSessionInvalidated(): void {
  for (const listener of mobileSessionInvalidationListeners) {
    listener()
  }
}

/** Best-effort server-side revocation for an owner sign-out. */
export async function revokeMobileSession(session: MobileSession): Promise<void> {
  const claims = decodeAccessTokenClaims(session.accessToken)
  if (!claims) {
    return
  }
  if (claims.deviceId && claims.deviceSecurityVersion !== undefined) {
    await request(
      `/hive/v1/cloud-account-devices/${claims.deviceId}/revoke`,
      { expectedSecurityVersion: claims.deviceSecurityVersion },
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Idempotency-Key': randomToken()
        }
      }
    )
    return
  }
  await request(
    `/hive/v1/cloud-sessions/${claims.sessionId}/revoke`,
    { expectedSecurityVersion: claims.sessionSecurityVersion, reason: 'owner_sign_out' },
    {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Idempotency-Key': randomToken()
      }
    }
  )
}

export async function loadStoredMobileSession(): Promise<MobileSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY)
  if (!raw) {
    return null
  }
  try {
    return parseSession(JSON.parse(raw))
  } catch {
    await clearStoredMobileSession()
    return null
  }
}

export async function saveMobileSession(session: MobileSession): Promise<void> {
  try {
    // Keep one authoritative, atomically replaceable session record. Storing
    // the same bearer credentials under three keys creates extra sensitive
    // copies and can leave readers with a partially updated token pair.
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session))
    // Remove keys written by older builds without making a successful login
    // depend on best-effort migration cleanup.
    await Promise.allSettled([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)
    ])
  } catch (failure) {
    await Promise.allSettled([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.deleteItemAsync(SESSION_KEY)
    ])
    throw failure
  }
}

export async function clearStoredMobileSession(): Promise<void> {
  invalidateMobileSessionRefreshes()
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.deleteItemAsync(SESSION_KEY)
    ])
  } finally {
    notifyMobileSessionInvalidated()
  }
}

export async function loadMobileAccountSecurity(): Promise<MobileAccountSecurity> {
  const value = await requestWithCurrentSession('/hive/v1/account/security', undefined, 'GET')
  if (!isRecord(value) || typeof value.accountId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.accountId)
    || typeof value.userName !== 'string' || !value.userName.trim()
    || typeof value.displayName !== 'string' || !value.displayName.trim() || typeof value.phoneBound !== 'boolean'
    || (value.phoneNumber !== null && value.phoneNumber !== undefined
      && (typeof value.phoneNumber !== 'string' || !value.phoneNumber.trim()))) {
    throw new Error('登录服务返回了无效账户安全信息')
  }
  return {
    accountId: value.accountId,
    userName: value.userName,
    displayName: value.displayName,
    phoneNumber: typeof value.phoneNumber === 'string' ? value.phoneNumber : null,
    phoneBound: value.phoneBound
  }
}

async function requireMobileAccessToken(): Promise<MobileSession> {
  const session = await loadStoredMobileSession()
  if (!session) {
    throw new Error('mobile_session_required')
  }
  return session
}

async function requestWithCurrentSession<T>(
  path: string,
  body: unknown,
  method: 'GET' | 'POST' = 'POST'
): Promise<T> {
  const session = await requireMobileAccessToken()
  const send = (accessToken: string) => request<T>(path, body, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  try {
    return await send(session.accessToken)
  } catch (failure) {
    if (!(failure instanceof MobileApiError) || failure.status !== 401) {
      throw failure
    }
    try {
      const refreshed = await refreshMobileSession(session.refreshToken)
      return send(refreshed.accessToken)
    } catch (refreshFailure) {
      if (isTerminalMobileSessionError(refreshFailure)) {
        await clearStoredMobileSession()
      }
      throw refreshFailure
    }
  }
}

export async function setMobilePassword(newPassword: string): Promise<void> {
  if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
    throw new Error('密码长度必须为 12-128 个字符')
  }
  await requestWithCurrentSession('/hive/v1/account/security/password', { newPassword })
  await clearStoredMobileSession()
}

export async function startMobilePasswordReset(phoneNumber: string): Promise<MobileAccountSecurityChallenge> {
  const value = await request<unknown>('/hive/v1/auth/password-reset/start', { phoneNumber })
  if (!isRecord(value) || typeof value.challengeId !== 'string' || !value.challengeId.trim()
    || typeof value.bindingId !== 'string' || !value.bindingId.trim()
    || typeof value.expiresInSeconds !== 'number' || !Number.isSafeInteger(value.expiresInSeconds)
    || value.expiresInSeconds <= 0 || typeof value.resendAfterSeconds !== 'number'
    || !Number.isSafeInteger(value.resendAfterSeconds) || value.resendAfterSeconds < 0
    || value.resendAfterSeconds > value.expiresInSeconds) {
    throw new Error('登录服务返回了无效密码重置挑战')
  }
  return value as MobileAccountSecurityChallenge
}

export async function verifyMobilePasswordReset(
  challengeId: string, bindingId: string, smsCode: string, newPassword: string
): Promise<void> {
  if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
    throw new Error('密码长度必须为 12-128 个字符')
  }
  await request('/hive/v1/auth/password-reset/verify', { challengeId, bindingId, smsCode, newPassword })
  await clearStoredMobileSession()
}

export async function startMobilePhoneBinding(phoneNumber: string): Promise<MobileAccountSecurityChallenge> {
  const value = await requestWithCurrentSession<unknown>('/hive/v1/account/security/phone/challenge', { phoneNumber })
  if (!isRecord(value) || typeof value.challengeId !== 'string' || !value.challengeId.trim()
    || typeof value.bindingId !== 'string' || !value.bindingId.trim()
    || typeof value.expiresInSeconds !== 'number' || !Number.isSafeInteger(value.expiresInSeconds)
    || value.expiresInSeconds <= 0 || typeof value.resendAfterSeconds !== 'number'
    || !Number.isSafeInteger(value.resendAfterSeconds) || value.resendAfterSeconds < 0
    || value.resendAfterSeconds > value.expiresInSeconds) {
    throw new Error('登录服务返回了无效手机号绑定挑战')
  }
  return value as MobileAccountSecurityChallenge
}

export async function verifyMobilePhoneBinding(
  challengeId: string,
  bindingId: string,
  smsCode: string
): Promise<void> {
  await requestWithCurrentSession('/hive/v1/account/security/phone/verify', { challengeId, bindingId, smsCode })
  await clearStoredMobileSession()
}

let refreshInFlight: { refreshToken: string; promise: Promise<MobileSession> } | null = null
let refreshEpoch = 0

export function invalidateMobileSessionRefreshes(): void {
  refreshEpoch += 1
  // Do not hand a caller the superseded promise when a new sign-in or
  // sign-out immediately starts another refresh with the same token.
  refreshInFlight = null
}

export function refreshMobileSession(refreshToken: string): Promise<MobileSession> {
  if (refreshInFlight?.refreshToken === refreshToken) {
    return refreshInFlight.promise
  }
  const expectedEpoch = refreshEpoch
  const promise = (async () => {
    const session = parseSession(await request('/hive/v1/auth/session-refresh', { refreshToken }))
    if (refreshEpoch !== expectedEpoch) {
      throw new Error('mobile_session_refresh_superseded')
    }
    await saveMobileSession(session)
    return session
  })()
  refreshInFlight = { refreshToken, promise }
  void promise.then(
    () => {
      if (refreshInFlight?.promise === promise) {
        refreshInFlight = null
      }
    },
    () => {
      if (refreshInFlight?.promise === promise) {
        refreshInFlight = null
      }
    }
  )
  return promise
}
