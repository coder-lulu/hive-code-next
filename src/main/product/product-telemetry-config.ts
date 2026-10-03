export type ProductTelemetryTransport = {
  channel: 'stable' | 'rc'
  writeKey: string
  host: string
}

type ProductTelemetryTransportInput = {
  enabled: boolean
  buildIdentity: unknown
  writeKey: unknown
  endpoint: unknown
}

export function resolveProductTelemetryTransport({
  enabled,
  buildIdentity,
  writeKey,
  endpoint
}: ProductTelemetryTransportInput): ProductTelemetryTransport | null {
  if (!enabled || (buildIdentity !== 'stable' && buildIdentity !== 'rc')) {
    return null
  }
  if (typeof writeKey !== 'string' || writeKey.trim().length === 0) {
    return null
  }
  if (typeof endpoint !== 'string' || endpoint.trim().length === 0) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(endpoint.trim())
  } catch {
    return null
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    return null
  }

  return {
    channel: buildIdentity,
    writeKey: writeKey.trim(),
    host: parsed.toString()
  }
}
