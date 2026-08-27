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

/** Best-effort server-side revocation for an owner sign-out. */
export async function revokeMobileSession(session: MobileSession): Promise<void> {
  const claims = decodeAccessTokenClaims(session.accessToken)
  if (!claims) {
    return
  }
  await request(
    `/hive/v1/cloud-sessions/${claims.sessionId}/revoke`,
    {
      expectedSecurityVersion: claims.sessionSecurityVersion,
      reason: 'owner_sign_out'
    },
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
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(SESSION_KEY)
  ])
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
