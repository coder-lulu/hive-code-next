/**
 * HiveCode's public release version contract.
 *
 * This is intentionally narrower than the runtime's historical version parser:
 * release artifacts use SemVer core plus the beta/legacy RC prerelease forms.
 * The `v` prefix belongs to Git tags and is never part of versionName.
 */
const PRODUCT_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:beta|rc)\.(?:0|[1-9]\d*))?$/
const BETA_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta\.(?:0|[1-9]\d*)$/
const STABLE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/

type ParsedProductVersion = {
  major: bigint
  minor: bigint
  patch: bigint
  prerelease: 'beta' | 'rc' | null
  prereleaseNumber: bigint
}

export type ProductReleaseChannel = 'internal' | 'beta' | 'stable'

export function isProductVersion(value: string): boolean {
  return typeof value === 'string' && PRODUCT_VERSION_PATTERN.test(value)
}

export function isStableProductVersion(value: string): boolean {
  return typeof value === 'string' && STABLE_VERSION_PATTERN.test(value)
}

export function isBetaProductVersion(value: string): boolean {
  return typeof value === 'string' && BETA_VERSION_PATTERN.test(value)
}

export function isLegacyRcProductVersion(value: string): boolean {
  return (
    typeof value === 'string' &&
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-rc\.(?:0|[1-9]\d*)$/.test(value)
  )
}

function parseProductVersion(value: string): ParsedProductVersion | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-(beta|rc)\.(\d+))?$/)
  if (!match || !isProductVersion(value)) {
    return null
  }
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: (match[4] as 'beta' | 'rc' | undefined) ?? null,
    prereleaseNumber: BigInt(match[5] ?? 0)
  }
}

/** Compare product versions using SemVer precedence, including legacy rc reads. */
export function compareProductVersions(left: string, right: string): number {
  const a = parseProductVersion(left)
  const b = parseProductVersion(right)
  if (!a || !b) {
    throw new Error('Cannot compare invalid product versions')
  }
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) {
      return a[key] > b[key] ? 1 : -1
    }
  }
  if (a.prerelease === b.prerelease) {
    if (a.prereleaseNumber === b.prereleaseNumber) {
      return 0
    }
    return a.prereleaseNumber > b.prereleaseNumber ? 1 : -1
  }
  if (a.prerelease === null) {
    return 1
  }
  if (b.prerelease === null) {
    return -1
  }
  return a.prerelease === 'rc' ? 1 : -1
}

/** Channel validation for new releases. Legacy RC is accepted only during migration. */
export function isProductVersionForChannel(value: string, channel: ProductReleaseChannel): boolean {
  const version = value
  if (channel === 'stable') {
    return isStableProductVersion(version)
  }
  if (channel === 'beta') {
    return isBetaProductVersion(version)
  }
  return isStableProductVersion(version) || isBetaProductVersion(version)
}

export function normalizeProductVersion(value: string): string | null {
  const normalized = value.trim().replace(/^v/i, '')
  return isProductVersion(normalized) ? normalized : null
}
