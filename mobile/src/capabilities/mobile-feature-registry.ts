export const MOBILE_FEATURE_STATUSES = [
  'live',
  'ui-preview',
  'configured',
  'unsupported',
  'removed'
] as const

export type MobileFeatureStatus = (typeof MOBILE_FEATURE_STATUSES)[number]

export const MOBILE_LIVE_FEATURE_IDS = [
  'connectedWork',
  'pairing',
  'workspaces',
  'session',
  'terminal',
  'nativeChat',
  'browser',
  'files',
  'sourceControl',
  'pullRequests',
  'tasks',
  'notifications',
  'agentHistory',
  'agentAccounts',
  'settings',
  'account'
] as const

export const MOBILE_FUTURE_FEATURE_IDS = [
  'cloudWork',
  'login',
  'privacy',
  'legal',
  'feedback',
  'storage',
  'desktopDownload',
  'update',
  'consumerCredits'
] as const

export const MOBILE_FEATURE_IDS = [
  ...MOBILE_LIVE_FEATURE_IDS,
  ...MOBILE_FUTURE_FEATURE_IDS
] as const

export type MobileFeatureId = (typeof MOBILE_FEATURE_IDS)[number]

type MobileFeatureConfigurationKey =
  | 'privacyPolicy'
  | 'termsOfService'
  | 'feedbackEndpoint'
  | 'desktopDownload'
  | 'updateEndpoint'

export interface MobileFeatureDefinition {
  readonly id: MobileFeatureId
  readonly status: MobileFeatureStatus
  readonly requiredConfiguration?: MobileFeatureConfigurationKey
}

export interface MobileFeatureConfiguration {
  readonly privacyPolicy: string | null
  readonly termsOfService: string | null
  readonly feedbackEndpoint: string | null
  readonly desktopDownload: string | null
  readonly updateEndpoint: string | null
}

export interface ResolvedMobileFeatureCapability {
  readonly id: MobileFeatureId
  readonly status: MobileFeatureStatus
  readonly isAvailable: boolean
  readonly configurationValue: string | null
  readonly unavailableReason: string | null
}

export interface ResolveMobileFeatureCapabilityOptions {
  readonly productConfig?: unknown
  readonly statusOverride?: unknown
}

const liveFeatureDefinitions = MOBILE_LIVE_FEATURE_IDS.map((id) => ({
  id,
  status: 'live' as const
}))

const futureFeatureDefinitions: readonly MobileFeatureDefinition[] = [
  { id: 'cloudWork', status: 'ui-preview' },
  { id: 'login', status: 'ui-preview' },
  { id: 'privacy', status: 'configured', requiredConfiguration: 'privacyPolicy' },
  { id: 'legal', status: 'configured', requiredConfiguration: 'termsOfService' },
  { id: 'feedback', status: 'configured', requiredConfiguration: 'feedbackEndpoint' },
  { id: 'storage', status: 'ui-preview' },
  {
    id: 'desktopDownload',
    status: 'configured',
    requiredConfiguration: 'desktopDownload'
  },
  { id: 'update', status: 'configured', requiredConfiguration: 'updateEndpoint' },
  { id: 'consumerCredits', status: 'removed' }
]

export const MOBILE_FEATURE_REGISTRY: Readonly<Record<MobileFeatureId, MobileFeatureDefinition>> =
  Object.fromEntries(
    [...liveFeatureDefinitions, ...futureFeatureDefinitions].map((definition) => [
      definition.id,
      definition
    ])
  ) as unknown as Readonly<Record<MobileFeatureId, MobileFeatureDefinition>>

const FEATURE_STATUS_SET = new Set<string>(MOBILE_FEATURE_STATUSES)

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function parseMobileFeatureHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const candidate = value.trim()
  if (!candidate) {
    return null
  }
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? candidate : null
  } catch {
    return null
  }
}

export function parseMobileFeatureStatus(
  value: unknown,
  fallback: MobileFeatureStatus = 'unsupported'
): MobileFeatureStatus {
  return typeof value === 'string' && FEATURE_STATUS_SET.has(value)
    ? (value as MobileFeatureStatus)
    : fallback
}

export function parseMobileFeatureConfiguration(value: unknown): MobileFeatureConfiguration {
  const root = asRecord(value)
  const publicLinks = asRecord(root?.publicLinks)
  const endpoints = asRecord(root?.endpoints)
  return {
    privacyPolicy: parseMobileFeatureHttpUrl(publicLinks?.privacyPolicy),
    termsOfService: parseMobileFeatureHttpUrl(publicLinks?.termsOfService),
    feedbackEndpoint: parseMobileFeatureHttpUrl(endpoints?.feedback),
    desktopDownload: parseMobileFeatureHttpUrl(publicLinks?.desktopDownload),
    updateEndpoint: parseMobileFeatureHttpUrl(endpoints?.update)
  }
}

export function getMobileFeatureUnavailableReason(
  status: MobileFeatureStatus,
  hasRequiredConfiguration = false
): string | null {
  switch (status) {
    case 'live':
      return null
    case 'ui-preview':
      return '此功能当前仅提供界面预览，服务能力正在建设。'
    case 'configured':
      return hasRequiredConfiguration ? null : '此功能尚未配置。'
    case 'unsupported':
      return '当前运行环境不支持此功能。'
    case 'removed':
      return productNameText('此功能已从 Orca 中移除。')
  }
}

export function resolveMobileFeatureCapability(
  id: MobileFeatureId,
  options: ResolveMobileFeatureCapabilityOptions = {}
): ResolvedMobileFeatureCapability {
  const definition = MOBILE_FEATURE_REGISTRY[id]
  // Removed products are fail-closed and cannot be revived by remote configuration.
  const status =
    definition.status === 'removed'
      ? 'removed'
      : parseMobileFeatureStatus(options.statusOverride, definition.status)
  const configuration = parseMobileFeatureConfiguration(options.productConfig)
  const configurationValue = definition.requiredConfiguration
    ? configuration[definition.requiredConfiguration]
    : null
  const hasRequiredConfiguration = configurationValue !== null
  const isAvailable = status === 'live' || (status === 'configured' && hasRequiredConfiguration)

  return {
    id,
    status,
    isAvailable,
    configurationValue,
    unavailableReason: getMobileFeatureUnavailableReason(status, hasRequiredConfiguration)
  }
}
import { productNameText } from '../product-brand'
