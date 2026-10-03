import { MOBILE_CLIENT_ID } from './mobile-auth-contract'
import { isRecord, request } from './mobile-sms-client'
import {
  mobileLoginFallbackConfiguration,
  type MobileLoginConfiguration,
  type MobileLoginProvider,
  type MobileLoginProviderId
} from './mobile-login-presentation'

const CONTRACT_REVISION = 'hive-login-capabilities-v1'
const DEFAULT_METHOD = 'phone_sms'
const PROVIDER_IDS = new Set<MobileLoginProviderId>(['github', 'wechat', 'qq'])
const PROVIDER_LABELS: Record<MobileLoginProviderId, string> = {
  github: '使用 GitHub 登录',
  wechat: '使用微信登录',
  qq: '使用 QQ 登录'
}

function isProviderId(value: unknown): value is MobileLoginProviderId {
  return typeof value === 'string' && PROVIDER_IDS.has(value as MobileLoginProviderId)
}

function parseProvider(value: unknown): MobileLoginProvider | null {
  if (!isRecord(value) || !isProviderId(value.id) || typeof value.authorizationPath !== 'string') {
    return null
  }
  const expectedPath = `/hive/v1/auth/provider-authorizations/${value.id}`
  if (value.authorizationPath !== expectedPath) {
    return null
  }
  return {
    id: value.id,
    enabled: true,
    accessibilityLabel: PROVIDER_LABELS[value.id],
    authorizationPath: expectedPath
  }
}

export function parseMobileLoginCapabilities(value: unknown): MobileLoginConfiguration | null {
  if (
    !isRecord(value) ||
    value.contractRevision !== CONTRACT_REVISION ||
    value.clientId !== MOBILE_CLIENT_ID ||
    value.defaultMethod !== DEFAULT_METHOD ||
    !Array.isArray(value.providers)
  ) {
    return null
  }
  const providers: MobileLoginProvider[] = []
  const seen = new Set<MobileLoginProviderId>()
  for (const candidate of value.providers) {
    const provider = parseProvider(candidate)
    if (!provider || seen.has(provider.id)) {
      return null
    }
    seen.add(provider.id)
    providers.push(provider)
  }
  return { registrationEnabled: false, providers }
}

export async function loadMobileLoginConfiguration(): Promise<MobileLoginConfiguration> {
  try {
    const value = await request<unknown>(
      `/hive/v1/meta/login-capabilities?clientId=${encodeURIComponent(MOBILE_CLIENT_ID)}`,
      undefined,
      { method: 'GET' }
    )
    return parseMobileLoginCapabilities(value) ?? mobileLoginFallbackConfiguration
  } catch {
    return mobileLoginFallbackConfiguration
  }
}
