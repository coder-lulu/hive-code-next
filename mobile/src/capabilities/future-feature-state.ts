import { hivecodeProductConfig } from '../generated/product-config'
import {
  resolveMobileFeatureCapability,
  parseMobileFeatureHttpUrl,
  type MobileFeatureId,
  type ResolvedMobileFeatureCapability
} from './mobile-feature-registry'

export interface FutureFeatureUrlOpener {
  readonly canOpenURL: (url: string) => Promise<boolean>
  readonly openURL: (url: string) => Promise<unknown>
}

export interface FutureFeatureActionState {
  readonly capability: ResolvedMobileFeatureCapability
  readonly disabled: boolean
  readonly reason: string | null
}

export function resolveProductMobileFeature(
  id: MobileFeatureId,
  statusOverride?: unknown
): ResolvedMobileFeatureCapability {
  return resolveMobileFeatureCapability(id, {
    productConfig: hivecodeProductConfig,
    statusOverride
  })
}

export function resolveFutureFeatureActionState(
  id: MobileFeatureId,
  implementationAvailable: boolean,
  productConfig: unknown = hivecodeProductConfig
): FutureFeatureActionState {
  const capability = resolveMobileFeatureCapability(id, { productConfig })
  if (!implementationAvailable) {
    return {
      capability,
      disabled: true,
      reason: capability.unavailableReason ?? '此功能的服务能力尚未接入。'
    }
  }
  return {
    capability,
    disabled: !capability.isAvailable,
    reason: capability.unavailableReason
  }
}

export async function openConfiguredFutureFeatureUrl(
  value: unknown,
  opener: FutureFeatureUrlOpener
): Promise<boolean> {
  const url = parseMobileFeatureHttpUrl(value)
  if (!url) {
    return false
  }
  try {
    if (!(await opener.canOpenURL(url))) {
      return false
    }
    await opener.openURL(url)
    return true
  } catch {
    return false
  }
}
