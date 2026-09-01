import { PRIMARY_SCHEME, SCHEME_COMPATIBILITY_ALIASES } from './brand'

const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const LEGACY_PRODUCTION_HOSTS = new Set(['app.orca.dev', 'share.onorca.dev'])
const SUPPORTED_PROTOCOLS = new Set([
  `${PRIMARY_SCHEME}:`,
  ...SCHEME_COMPATIBILITY_ALIASES.map((scheme) => `${scheme}:`)
])

export function formatSkillShareLink(shareId: string): string {
  if (!SHARE_ID_PATTERN.test(shareId)) {
    throw new Error('skill-share-id-invalid')
  }
  return `${PRIMARY_SCHEME}://skills/share/${shareId}`
}

export function parseSkillShareId(value: string): string | null {
  const trimmed = value.trim()
  if (SHARE_ID_PATTERN.test(trimmed)) {
    return trimmed
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (SUPPORTED_PROTOCOLS.has(url.protocol)) {
    const match = `${url.host}${url.pathname}`.match(/^skills\/share\/([A-Za-z0-9_-]{1,128})\/?$/)
    return match?.[1] ?? null
  }
  const developmentHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(developmentHost && url.protocol === 'http:')) {
    return null
  }
  if (!LEGACY_PRODUCTION_HOSTS.has(url.hostname) && !developmentHost) {
    return null
  }
  const match = url.pathname.match(/^\/skills\/share\/([A-Za-z0-9_-]{1,128})\/?$/)
  return match?.[1] ?? null
}

export function skillShareIdFromArguments(argv: readonly string[]): string | null {
  for (const value of argv) {
    const id = parseSkillShareId(value)
    if (id && (value.includes('/skills/share/') || SUPPORTED_PROTOCOLS.has(safeProtocol(value)))) {
      return id
    }
  }
  return null
}

function safeProtocol(value: string): string {
  try {
    return new URL(value).protocol
  } catch {
    return ''
  }
}
