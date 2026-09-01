import { sha256 } from '@noble/hashes/sha256'
import * as Linking from 'expo-linking'
import * as SecureStore from 'expo-secure-store'
import {
  MOBILE_AUTHORIZATION_SCOPE,
  MOBILE_CLIENT_ID,
  MOBILE_REDIRECT_URI
} from './mobile-auth-contract'
import { parseSession, saveMobileSession, type MobileSession } from './mobile-sms-auth'
import { registerMobileDeviceAuthorization } from './mobile-device-authorization'
import {
  encodeBase64Url,
  isRecord,
  MobileApiError,
  mobileApiUrl,
  randomToken,
  request
} from './mobile-sms-client'
import type { MobileLoginProvider, MobileLoginProviderId } from './mobile-login-presentation'

const PENDING_PROVIDER_FLOW_KEY = 'hivecode.mobile.auth.pending-provider-flow'
const PROVIDER_AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000
const CALLBACK_PROTOCOL = 'hivecode:'
const CALLBACK_HOST = 'auth'
const CALLBACK_PATH = '/callback'

type PendingProviderFlow = {
  readonly version: 1
  readonly providerId: MobileLoginProviderId
  readonly authorizationPath: string
  readonly state: string
  readonly nonce: string
  readonly codeVerifier: string
  readonly expiresAt: number
}

function expectedAuthorizationPath(providerId: MobileLoginProviderId): string {
  return `/hive/v1/auth/provider-authorizations/${providerId}`
}

function isPendingProviderFlow(value: unknown): value is PendingProviderFlow {
  if (!isRecord(value)) {
    return false
  }
  const providerId = value.providerId
  return (
    value.version === 1 &&
    (providerId === 'github' || providerId === 'wechat' || providerId === 'qq') &&
    value.authorizationPath === expectedAuthorizationPath(providerId) &&
    typeof value.state === 'string' &&
    value.state.length > 0 &&
    typeof value.nonce === 'string' &&
    value.nonce.length > 0 &&
    typeof value.codeVerifier === 'string' &&
    value.codeVerifier.length > 0 &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt)
  )
}

async function loadPendingProviderFlow(): Promise<PendingProviderFlow | null> {
  const raw = await SecureStore.getItemAsync(PENDING_PROVIDER_FLOW_KEY)
  if (!raw) {
    return null
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (isPendingProviderFlow(value)) {
      return value
    }
  } catch {}
  await SecureStore.deleteItemAsync(PENDING_PROVIDER_FLOW_KEY)
  return null
}

async function clearPendingProviderFlow(state?: string): Promise<void> {
  if (state) {
    const pending = await loadPendingProviderFlow()
    if (!pending || pending.state !== state) {
      return
    }
  }
  await SecureStore.deleteItemAsync(PENDING_PROVIDER_FLOW_KEY)
}

function validateProvider(provider: MobileLoginProvider): void {
  if (!provider.enabled || provider.authorizationPath !== expectedAuthorizationPath(provider.id)) {
    throw new Error('mobile_provider_unavailable')
  }
}

export async function beginMobileProviderLogin(
  provider: MobileLoginProvider,
  termsAccepted: boolean
): Promise<void> {
  if (!termsAccepted) {
    throw new Error('请先同意协议')
  }
  validateProvider(provider)
  const nonce = randomToken()
  const state = randomToken()
  const codeVerifier = randomToken()
  const codeChallenge = encodeBase64Url(sha256(codeVerifier))
  await registerMobileDeviceAuthorization(nonce)
  const pending: PendingProviderFlow = {
    version: 1,
    providerId: provider.id,
    authorizationPath: provider.authorizationPath,
    state,
    nonce,
    codeVerifier,
    expiresAt: Date.now() + PROVIDER_AUTHORIZATION_TIMEOUT_MS
  }
  await SecureStore.setItemAsync(PENDING_PROVIDER_FLOW_KEY, JSON.stringify(pending))

  const authorizationUrl = new URL(mobileApiUrl(provider.authorizationPath))
  authorizationUrl.searchParams.set('client_id', MOBILE_CLIENT_ID)
  authorizationUrl.searchParams.set('redirect_uri', MOBILE_REDIRECT_URI)
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('scope', MOBILE_AUTHORIZATION_SCOPE)
  authorizationUrl.searchParams.set('state', state)
  authorizationUrl.searchParams.set('nonce', nonce)
  authorizationUrl.searchParams.set('code_challenge', codeChallenge)
  authorizationUrl.searchParams.set('code_challenge_method', 'S256')
  try {
    await Linking.openURL(authorizationUrl.toString())
  } catch (failure) {
    await clearPendingProviderFlow(state)
    throw failure
  }
}

export function isMobileProviderCallbackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl.trim())
    return (
      url.protocol.toLowerCase() === CALLBACK_PROTOCOL &&
      url.hostname.toLowerCase() === CALLBACK_HOST &&
      url.pathname === CALLBACK_PATH &&
      !url.username &&
      !url.password &&
      !url.port
    )
  } catch {
    return false
  }
}

export function isRetryableMobileProviderLoginFailure(failure: unknown): boolean {
  return failure instanceof MobileApiError && failure.retryable
}

function singleParameter(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name)
  return values.length === 1 && values[0] ? values[0] : null
}

async function completeMobileProviderLoginInner(rawUrl: string): Promise<MobileSession> {
  if (!isMobileProviderCallbackUrl(rawUrl)) {
    throw new Error('mobile_provider_callback_invalid')
  }
  const url = new URL(rawUrl.trim())
  const state = singleParameter(url, 'state')
  const codes = url.searchParams.getAll('code')
  const errors = url.searchParams.getAll('error')
  if (
    !state ||
    url.hash ||
    codes.length + errors.length !== 1 ||
    (errors.length === 1 && !errors[0])
  ) {
    throw new Error('mobile_provider_callback_invalid')
  }

  const pending = await loadPendingProviderFlow()
  if (!pending) {
    throw new Error('mobile_provider_callback_expired')
  }
  if (pending.state !== state) {
    throw new Error('mobile_provider_callback_state_mismatch')
  }
  if (pending.expiresAt <= Date.now()) {
    await clearPendingProviderFlow(state)
    throw new Error('mobile_provider_callback_expired')
  }
  if (errors.length === 1) {
    await clearPendingProviderFlow(state)
    throw new Error('mobile_provider_authorization_cancelled')
  }
  const authorizationCode = codes.length === 1 && codes[0] ? codes[0] : null
  if (!authorizationCode) {
    throw new Error('mobile_provider_callback_invalid')
  }

  let exchangeCompleted = false
  try {
    const session = parseSession(
      await request('/hive/v1/auth/session-exchange', {
        authorizationCode,
        codeVerifier: pending.codeVerifier,
        redirectUri: MOBILE_REDIRECT_URI,
        clientId: MOBILE_CLIENT_ID,
        nonce: pending.nonce
      })
    )
    exchangeCompleted = true
    await saveMobileSession(session)
    await clearPendingProviderFlow(state)
    return session
  } catch (failure) {
    if (exchangeCompleted || !isRetryableMobileProviderLoginFailure(failure)) {
      await clearPendingProviderFlow(state)
    }
    throw failure
  }
}

let callbackQueue = Promise.resolve()

export function completeMobileProviderLogin(rawUrl: string): Promise<MobileSession> {
  const completion = callbackQueue.then(() => completeMobileProviderLoginInner(rawUrl))
  callbackQueue = completion.then(
    () => undefined,
    () => undefined
  )
  return completion
}

export function mobileProviderLoginErrorMessage(failure: unknown): string {
  if (failure instanceof Error && failure.message === 'mobile_provider_authorization_cancelled') {
    return '登录已取消。'
  }
  if (
    failure instanceof Error &&
    (failure.message === 'mobile_provider_unavailable' ||
      failure.message === 'mobile_provider_callback_expired' ||
      failure.message === 'mobile_provider_callback_state_mismatch' ||
      failure.message === 'mobile_provider_callback_invalid')
  ) {
    return '登录请求已失效，请重新尝试。'
  }
  return '登录服务暂时不可用，请稍后再试。'
}
