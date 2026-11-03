// Why: a plain-http page on another machine can be swapped by anyone on the LAN path, so a
// pairing code typed into it is exposed. Browsers treat loopback http as a secure context.
export function isInsecureRemoteWebOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false
  }
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return url.protocol === 'http:' && !isLoopbackHostname(url.hostname)
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  )
}

export const ALLOW_INSECURE_WEB_PAIRING_ENV = 'ORCA_ALLOW_INSECURE_WEB_PAIRING' as const

// Retain diagnostics for v1.4.225–v1.4.228 hosts that refuse cross-machine plain-HTTP pairing with this code.
export const INSECURE_WEB_ORIGIN_AUTH_CODE = 'insecure_origin' as const

// React Native also sends HTTP LAN Origins; only the web upgrade marker distinguishes browsers. Hosts ignore the query, preserving compatibility.
export const WEB_CLIENT_UPGRADE_PARAM = 'orca-client' as const
export const WEB_CLIENT_UPGRADE_VALUE = 'web' as const

export function withWebClientUpgradeMarker(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    url.searchParams.set(WEB_CLIENT_UPGRADE_PARAM, WEB_CLIENT_UPGRADE_VALUE)
    return url.toString()
  } catch {
    return endpoint
  }
}

/** True when an upgrade request path (`/path?query`) carries the web bundle's marker. */
export function hasWebClientUpgradeMarker(requestUrl: string | undefined): boolean {
  if (!requestUrl) {
    return false
  }
  try {
    return (
      new URL(requestUrl, 'http://upgrade.invalid').searchParams.get(WEB_CLIENT_UPGRADE_PARAM) ===
      WEB_CLIENT_UPGRADE_VALUE
    )
  } catch {
    return false
  }
}
