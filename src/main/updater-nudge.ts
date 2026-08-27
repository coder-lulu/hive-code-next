import { cancelUnreadResponseBody } from './lib/unread-response-body'
import { getProductExternalServiceEndpoints } from './product/product-external-service-endpoints'
import { fetchWithProductUpdaterSession } from './product/product-updater-session'
import { compareVersions, isValidVersion } from './updater-fallback'
import { readResponseTextWithLimit } from './updater-response-body'

const MAX_NUDGE_RESPONSE_BYTES = 64 * 1024

export type NudgeConfig = {
  id: string
  minVersion?: string
  maxVersion?: string
}

export async function fetchNudge(): Promise<NudgeConfig | null> {
  const nudgeUrl = getProductExternalServiceEndpoints().nudge
  if (!nudgeUrl) {
    return null
  }
  try {
    const res = await fetchWithProductUpdaterSession(nudgeUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) {
      await cancelUnreadResponseBody(res)
      return null
    }

    const body = await readResponseTextWithLimit(res, MAX_NUDGE_RESPONSE_BYTES)
    if (body === null) {
      return null
    }
    const json: unknown = JSON.parse(body)
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return null
    }

    const { id, minVersion, maxVersion } = json as Record<string, unknown>
    if (typeof id !== 'string' || !id.trim()) {
      return null
    }

    if (minVersion === undefined && maxVersion === undefined) {
      return null
    }

    if (minVersion !== undefined && typeof minVersion !== 'string') {
      return null
    }
    if (maxVersion !== undefined && typeof maxVersion !== 'string') {
      return null
    }
    if (minVersion !== undefined && !isValidVersion(minVersion)) {
      return null
    }
    if (maxVersion !== undefined && !isValidVersion(maxVersion)) {
      return null
    }
    if (
      minVersion !== undefined &&
      maxVersion !== undefined &&
      compareVersions(minVersion, maxVersion) > 0
    ) {
      return null
    }

    return {
      id: id.trim(),
      minVersion,
      maxVersion
    }
  } catch {
    return null
  }
}

export function versionMatchesRange(
  appVersion: string,
  range: { minVersion?: string; maxVersion?: string }
): boolean {
  if (range.minVersion !== undefined && compareVersions(appVersion, range.minVersion) < 0) {
    return false
  }
  if (range.maxVersion !== undefined && compareVersions(appVersion, range.maxVersion) > 0) {
    return false
  }
  return true
}

export function shouldApplyNudge(args: {
  nudge: NudgeConfig
  appVersion: string
  pendingUpdateNudgeId: string | null
  dismissedUpdateNudgeId: string | null
}): boolean {
  const { nudge, appVersion, pendingUpdateNudgeId, dismissedUpdateNudgeId } = args

  if (nudge.id === pendingUpdateNudgeId || nudge.id === dismissedUpdateNudgeId) {
    return false
  }

  return versionMatchesRange(appVersion, nudge)
}
