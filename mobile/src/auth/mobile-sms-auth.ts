import { sha256 } from '@noble/hashes/sha256'
import * as SecureStore from 'expo-secure-store'
import nacl from 'tweetnacl'
import {
  deviceIdentity,
  encodeBase64Url,
  isRecord,
  randomToken,
  request
} from './mobile-sms-client'
import { parseSession, saveMobileSession, type MobileSession } from './mobile-sms-session'
export {
  clearStoredMobileSession,
  isTerminalMobileSessionError,
  loadStoredMobileSession,
  invalidateMobileSessionRefreshes,
  parseSession,
  refreshMobileSession,
  revokeMobileSession,
  saveMobileSession
} from './mobile-sms-session'
export type { MobileSession } from './mobile-sms-session'

export const MOBILE_CLIENT_ID = 'hivecode-mobile'
export const MOBILE_REDIRECT_URI = 'hivecode://auth/callback'
// Mobile keeps its device key in OS-secure storage, so it can safely opt into
// the persistent trusted-device profile. The cloud console can revoke the
// resulting device at any time; a subsequent SMS login reactivates it.
export const MOBILE_SESSION_PROFILE = 'TRUSTED'

const PENDING_SMS_FLOWS_KEY = 'hivecode.mobile.auth.pending-sms-flows'

export type SmsChallenge = {
  readonly challengeId: string
  readonly expiresInSeconds: number
  readonly resendAfterSeconds: number
}

type PendingSmsFlow = {
  readonly phoneNumber: string
  readonly nonce: string
  readonly state: string
  readonly codeVerifier: string
  readonly codeChallenge: string
  readonly redirectUri: string
  readonly clientId: string
  readonly stage: 'ISSUED' | 'VERIFIED' | 'AUTHORIZED' | 'EXCHANGED'
  readonly expiresAt: number
  readonly authorizationCode?: string
}

type SmsAuthorization = { readonly authorizationCode: string; readonly state?: string }

const pendingFlows = new Map<string, PendingSmsFlow>()
const MAX_PENDING_FLOWS = 8
let restorePromise: Promise<void> | null = null
let persistenceQueue = Promise.resolve()

function persistPendingFlows(): void {
  const snapshot = JSON.stringify([...pendingFlows.entries()])
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(async () => {
      if (pendingFlows.size === 0) {
        await SecureStore.deleteItemAsync(PENDING_SMS_FLOWS_KEY)
      } else {
        await SecureStore.setItemAsync(PENDING_SMS_FLOWS_KEY, snapshot)
      }
    })
    .catch(() => undefined)
}

function validPendingFlow(value: unknown): value is [string, PendingSmsFlow] {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string') {
    return false
  }
  const flow = value[1]
  if (!isRecord(flow)) {
    return false
  }
  const stage = flow.stage
  return (
    typeof flow.phoneNumber === 'string' &&
    typeof flow.nonce === 'string' &&
    typeof flow.state === 'string' &&
    typeof flow.codeVerifier === 'string' &&
    typeof flow.codeChallenge === 'string' &&
    typeof flow.redirectUri === 'string' &&
    typeof flow.clientId === 'string' &&
    typeof flow.expiresAt === 'number' &&
    Number.isFinite(flow.expiresAt) &&
    (stage === 'ISSUED' ||
      stage === 'VERIFIED' ||
      stage === 'AUTHORIZED' ||
      stage === 'EXCHANGED') &&
    (flow.authorizationCode === undefined || typeof flow.authorizationCode === 'string')
  )
}

async function restorePendingFlows(): Promise<void> {
  if (!restorePromise) {
    restorePromise = (async () => {
      const raw = await SecureStore.getItemAsync(PENDING_SMS_FLOWS_KEY)
      if (!raw) {
        return
      }
      try {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) {
          throw new Error('invalid pending flow store')
        }
        const now = Date.now()
        for (const candidate of parsed) {
          if (!validPendingFlow(candidate)) {
            continue
          }
          const [challengeId, flow] = candidate
          if (flow.expiresAt <= now || flow.stage === 'EXCHANGED') {
            continue
          }
          if (pendingFlows.size < MAX_PENDING_FLOWS) {
            if (flow.stage === 'AUTHORIZED') {
              // Authorization codes are one-time credentials. Never restore
              // one from disk after process death; obtain a fresh code from
              // the already-verified challenge instead.
              const { authorizationCode: _discarded, ...retryableFlow } = flow
              pendingFlows.set(challengeId, { ...retryableFlow, stage: 'VERIFIED' })
            } else {
              pendingFlows.set(challengeId, flow)
            }
          }
        }
        persistPendingFlows()
      } catch {
        await SecureStore.deleteItemAsync(PENDING_SMS_FLOWS_KEY)
      }
    })().catch(() => undefined)
  }
  await restorePromise
}

export async function requestMobileSms(
  phoneNumber: string,
  termsAccepted: boolean
): Promise<SmsChallenge> {
  await restorePendingFlows()
  if (!termsAccepted) {
    throw new Error('请先同意协议')
  }
  const identity = await deviceIdentity()
  const nonce = randomToken()
  const state = randomToken()
  const codeVerifier = randomToken()
  const codeChallenge = encodeBase64Url(sha256(codeVerifier))
  const proofInput = `hive-device-authorization-v2\n${nonce}\n${MOBILE_CLIENT_ID}\n${identity.deviceLabel}\n${MOBILE_SESSION_PROFILE}`
  const proof = encodeBase64Url(
    nacl.sign.detached(new TextEncoder().encode(proofInput), identity.secretKey)
  )

  await request('/hive/v1/auth/device-authorizations', {
    nonce,
    clientId: MOBILE_CLIENT_ID,
    devicePublicKey: identity.publicKey,
    deviceLabel: identity.deviceLabel,
    sessionProfile: MOBILE_SESSION_PROFILE,
    proof
  })
  const challenge = await request<SmsChallenge>('/hive/v1/auth/sms-challenges', {
    nonce,
    clientId: MOBILE_CLIENT_ID,
    phoneNumber,
    locale: 'zh-CN',
    termsAccepted: true
  })
  if (
    !isRecord(challenge) ||
    typeof challenge.challengeId !== 'string' ||
    typeof challenge.expiresInSeconds !== 'number' ||
    !Number.isSafeInteger(challenge.expiresInSeconds) ||
    challenge.expiresInSeconds <= 0 ||
    typeof challenge.resendAfterSeconds !== 'number' ||
    !Number.isSafeInteger(challenge.resendAfterSeconds) ||
    challenge.resendAfterSeconds < 0 ||
    challenge.resendAfterSeconds > challenge.expiresInSeconds
  ) {
    throw new Error('登录服务返回了无效验证码挑战')
  }
  while (pendingFlows.size >= MAX_PENDING_FLOWS) {
    const oldest = pendingFlows.keys().next().value
    if (typeof oldest !== 'string') {
      break
    }
    pendingFlows.delete(oldest)
  }
  pendingFlows.set(challenge.challengeId, {
    phoneNumber,
    nonce,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri: MOBILE_REDIRECT_URI,
    clientId: MOBILE_CLIENT_ID,
    stage: 'ISSUED',
    expiresAt: Date.now() + challenge.expiresInSeconds * 1000
  })
  persistPendingFlows()
  return challenge
}

export async function loginWithMobileSms(
  phoneNumber: string,
  smsCode: string,
  challengeId: string,
  termsAccepted: boolean
): Promise<MobileSession> {
  await restorePendingFlows()
  let flow = pendingFlows.get(challengeId)
  if (!flow) {
    throw new Error('验证码已失效，请重新获取')
  }
  if (flow.expiresAt <= Date.now()) {
    pendingFlows.delete(challengeId)
    persistPendingFlows()
    throw new Error('验证码已失效，请重新获取')
  }
  if (!termsAccepted) {
    throw new Error('请先同意协议')
  }
  if (phoneNumber !== flow.phoneNumber) {
    throw new Error('手机号已变更，请重新获取验证码')
  }
  let exchangeCompleted = false
  try {
    if (flow.stage === 'ISSUED') {
      await request(`/hive/v1/auth/sms-challenges/${encodeURIComponent(challengeId)}/verify`, {
        nonce: flow.nonce,
        clientId: flow.clientId,
        smsCode,
        termsAccepted: true
      })
      flow = { ...flow, stage: 'VERIFIED' }
      pendingFlows.set(challengeId, flow)
      persistPendingFlows()
    }

    if (flow.stage === 'VERIFIED') {
      const authorization = await request<SmsAuthorization>('/hive/v1/auth/sms-authorizations', {
        nonce: flow.nonce,
        clientId: flow.clientId,
        codeChallenge: flow.codeChallenge,
        redirectUri: flow.redirectUri,
        state: flow.state
      })
      if (
        !isRecord(authorization) ||
        typeof authorization.authorizationCode !== 'string' ||
        (authorization.state !== undefined && authorization.state !== flow.state)
      ) {
        throw new Error('登录服务返回了无效授权码')
      }
      flow = {
        ...flow,
        stage: 'AUTHORIZED',
        authorizationCode: authorization.authorizationCode
      }
      pendingFlows.set(challengeId, flow)
      persistPendingFlows()
    }

    if (flow.stage !== 'AUTHORIZED' || !flow.authorizationCode) {
      throw new Error('登录流程状态无效，请重新获取验证码')
    }
    const session = parseSession(
      await request('/hive/v1/auth/session-exchange', {
        authorizationCode: flow.authorizationCode,
        codeVerifier: flow.codeVerifier,
        redirectUri: flow.redirectUri,
        clientId: flow.clientId,
        nonce: flow.nonce
      })
    )
    exchangeCompleted = true
    await saveMobileSession(session)
    pendingFlows.set(challengeId, { ...flow, stage: 'EXCHANGED' })
    persistPendingFlows()
    return session
  } catch (failure) {
    const current = pendingFlows.get(challengeId)
    if (exchangeCompleted) {
      // The server has already committed a session; never retry the one-time
      // authorization code after a local persistence failure.
      pendingFlows.delete(challengeId)
      persistPendingFlows()
    } else if (current?.stage === 'AUTHORIZED') {
      // Authorization codes are single-use.  A transport/Keycloak failure must
      // return to the verified stage so the next attempt obtains a fresh code.
      const { authorizationCode: _discarded, ...retryableFlow } = current
      pendingFlows.set(challengeId, { ...retryableFlow, stage: 'VERIFIED' })
      persistPendingFlows()
    }
    throw failure
  } finally {
    if (pendingFlows.get(challengeId)?.stage === 'EXCHANGED') {
      pendingFlows.delete(challengeId)
      persistPendingFlows()
    }
  }
}
