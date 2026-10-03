import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, 'config', 'product', 'hivecode.product.json')
const GENERATED_RELATIVE_PATHS = [
  path.join('src', 'shared', 'generated', 'product-config.ts'),
  path.join('mobile', 'src', 'generated', 'product-config.ts')
]
const ENDPOINT_KEYS = [
  'artifacts',
  'cloud',
  'identityIssuer',
  'update',
  'telemetry',
  'diagnostics',
  'feedback',
  'pluginKillList',
  'pluginMarketplace',
  'changelog',
  'nudge'
]
const SERVICE_KEYS = ['api', 'identity', 'oss', 'update']
const SECRET_KEY_PATTERN = /(secret|token|password|private.?key|api.?key|credential)/i
const CLI_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/
const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const GITHUB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/
// Keep legacy rc readable during migration; publishing workflows must emit beta
// or stable and never append an internal suffix to the product version.
const PRODUCT_UPDATE_CHANNELS = new Set(['internal', 'stable', 'beta', 'rc'])
const PRODUCT_UPDATE_PROVIDERS = new Set(['github', 'hivecloud'])
const HIVECLOUD_UPDATE_CHECK_PATH = '/hive/v1/updates/check'
const STRICT_HTTPS_ENDPOINTS = new Set(['artifacts', 'pluginMarketplace', 'changelog', 'nudge'])
const ORIGIN_ONLY_ENDPOINTS = new Set(['artifacts'])

const REQUIRED_ROOT_KEYS = [
  'schemaVersion',
  'displayName',
  'shortName',
  'slug',
  'branding',
  'publicLinks',
  'cli',
  'schemes',
  'desktop',
  'mobile',
  'endpoints',
  'services'
]
const ROOT_KEYS = new Set(['$schema', ...REQUIRED_ROOT_KEYS])
const BRANDING_KEYS = new Set(['logoAsset', 'logoSha256'])
const PUBLIC_LINK_KEYS = new Set([
  'website',
  'documentation',
  'support',
  'community',
  'social',
  'desktopDownload',
  'androidDownload',
  'iosDownload',
  'privacyPolicy',
  'termsOfService'
])
const DESKTOP_KEYS = new Set([
  'appId',
  'executableName',
  'publisher',
  'updateProvider',
  'updateChannel',
  'updateRepository',
  'starRepository'
])
const MOBILE_KEYS = new Set(['bundleId', 'packageId'])
const CLI_KEYS = new Set(['primary', 'aliases'])
const SCHEME_KEYS = new Set(['primary', 'aliases'])
const SERVICE_GROUP_KEYS = new Set(['api', 'identity', 'oss', 'update'])
const SERVICE_API_KEYS = new Set(['baseUrl'])
const SERVICE_IDENTITY_KEYS = new Set(['issuer', 'userLoginUrl', 'clients'])
const SERVICE_IDENTITY_CLIENT_KEYS = new Set(['desktop', 'userWeb', 'operatorWeb'])
const SERVICE_OSS_KEYS = new Set(['enabled', 'endpoint', 'provider'])
const SERVICE_UPDATE_KEYS = new Set([
  'enabled',
  'endpoint',
  'checkEndpoint',
  'artifactCdnOrigin',
  'provider',
  'channel',
  'checkIntervalHours'
])

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown ${label} key: ${key}`)
    }
  }
}

function assertRequiredKeys(value, required, label) {
  for (const key of required) {
    if (!(key in value)) {
      throw new Error(`Missing required ${label} key: ${key}`)
    }
  }
}

function assertNoSecretLikeKeys(value, location = 'manifest') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretLikeKeys(item, `${location}[${index}]`))
    return
  }
  if (value === null || typeof value !== 'object') {
    return
  }
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`secret-like manifest key is not allowed: ${location}.${key}`)
    }
    assertNoSecretLikeKeys(nested, `${location}.${key}`)
  }
}

function assertNonEmptyString(value, label, pattern = null) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  if (pattern && !pattern.test(value)) {
    throw new Error(`${label} has an invalid format`)
  }
}

function assertAliasGroup(value, label, pattern) {
  assertObject(value, label)
  const keys = label === 'cli' ? CLI_KEYS : SCHEME_KEYS
  assertKnownKeys(value, keys, label)
  assertRequiredKeys(value, keys, label)
  assertNonEmptyString(value.primary, `${label}.primary`, pattern)
  if (!Array.isArray(value.aliases) || value.aliases.some((item) => typeof item !== 'string')) {
    throw new Error(`${label}.aliases must be an array of strings`)
  }
  const aliases = value.aliases.map((item) => item.trim())
  if (new Set(aliases).size !== aliases.length) {
    throw new Error(`${label}.aliases must not contain duplicates`)
  }
  if (aliases.includes(value.primary)) {
    throw new Error(`${label}.aliases must not duplicate the primary value`)
  }
  aliases.forEach((item) => assertNonEmptyString(item, `${label}.aliases`, pattern))
}

function assertOptionalString(value, label) {
  if (value !== null && value !== undefined && typeof value !== 'string') {
    throw new Error(`${label} must be a string or null`)
  }
}

function assertEndpoint(value, label, requireHttps = false, requireOrigin = false) {
  if (value === null || value === undefined || value === '') {
    return
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a URL or null`)
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid URL or null`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain embedded credentials`)
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${label} must not contain a query string or fragment`)
  }
  if (requireHttps && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS`)
  }
  if (requireOrigin && parsed.pathname !== '/') {
    throw new Error(`${label} must be an origin without a path`)
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (
    !['https:', 'http:'].includes(parsed.protocol) ||
    (parsed.protocol === 'http:' && !loopback)
  ) {
    throw new Error(`${label} must use HTTPS unless it targets loopback`)
  }
}

function assertProductManifest(manifest) {
  assertObject(manifest, 'manifest')
  assertNoSecretLikeKeys(manifest)
  assertKnownKeys(manifest, ROOT_KEYS, 'manifest')
  assertRequiredKeys(manifest, REQUIRED_ROOT_KEYS, 'manifest')
  if (manifest.schemaVersion !== 1) {
    throw new Error('schemaVersion must be 1')
  }
  assertNonEmptyString(manifest.displayName, 'displayName')
  assertNonEmptyString(manifest.shortName, 'shortName')
  assertNonEmptyString(manifest.slug, 'slug', SLUG_PATTERN)

  assertObject(manifest.branding, 'branding')
  assertKnownKeys(manifest.branding, BRANDING_KEYS, 'branding')
  assertRequiredKeys(manifest.branding, BRANDING_KEYS, 'branding')
  assertNonEmptyString(manifest.branding.logoAsset, 'branding.logoAsset')
  if (
    !/^resources\/[A-Za-z0-9._/-]+$/.test(manifest.branding.logoAsset) ||
    manifest.branding.logoAsset.includes('..')
  ) {
    throw new Error('branding.logoAsset must be a safe repository resources path')
  }
  assertNonEmptyString(manifest.branding.logoSha256, 'branding.logoSha256', /^[a-f0-9]{64}$/)

  assertObject(manifest.publicLinks, 'publicLinks')
  assertKnownKeys(manifest.publicLinks, PUBLIC_LINK_KEYS, 'publicLinks')
  assertRequiredKeys(manifest.publicLinks, PUBLIC_LINK_KEYS, 'publicLinks')
  for (const key of PUBLIC_LINK_KEYS) {
    assertEndpoint(manifest.publicLinks[key], `publicLinks.${key}`, true)
  }

  assertAliasGroup(manifest.cli, 'cli', CLI_NAME_PATTERN)
  assertAliasGroup(manifest.schemes, 'schemes', SCHEME_PATTERN)

  assertObject(manifest.desktop, 'desktop')
  assertKnownKeys(manifest.desktop, DESKTOP_KEYS, 'desktop')
  assertRequiredKeys(manifest.desktop, DESKTOP_KEYS, 'desktop')
  assertOptionalString(manifest.desktop.appId, 'desktop.appId')
  assertNonEmptyString(manifest.desktop.executableName, 'desktop.executableName')
  assertOptionalString(manifest.desktop.publisher, 'desktop.publisher')
  assertOptionalString(manifest.desktop.updateProvider, 'desktop.updateProvider')
  if (
    manifest.desktop.updateProvider &&
    !PRODUCT_UPDATE_PROVIDERS.has(manifest.desktop.updateProvider)
  ) {
    throw new Error('desktop.updateProvider must be github, hivecloud, or null')
  }
  assertOptionalString(manifest.desktop.updateChannel, 'desktop.updateChannel')
  if (
    manifest.desktop.updateChannel &&
    !PRODUCT_UPDATE_CHANNELS.has(manifest.desktop.updateChannel)
  ) {
    throw new Error('desktop.updateChannel must be internal, stable, beta, rc, or null')
  }
  assertOptionalString(manifest.desktop.updateRepository, 'desktop.updateRepository')
  if (manifest.desktop.updateRepository) {
    assertNonEmptyString(
      manifest.desktop.updateRepository,
      'desktop.updateRepository',
      GITHUB_REPOSITORY_PATTERN
    )
  }
  assertOptionalString(manifest.desktop.starRepository, 'desktop.starRepository')
  if (manifest.desktop.starRepository) {
    assertNonEmptyString(
      manifest.desktop.starRepository,
      'desktop.starRepository',
      GITHUB_REPOSITORY_PATTERN
    )
  }

  assertObject(manifest.mobile, 'mobile')
  assertKnownKeys(manifest.mobile, MOBILE_KEYS, 'mobile')
  assertRequiredKeys(manifest.mobile, MOBILE_KEYS, 'mobile')
  assertOptionalString(manifest.mobile.bundleId, 'mobile.bundleId')
  assertOptionalString(manifest.mobile.packageId, 'mobile.packageId')

  assertObject(manifest.endpoints, 'endpoints')
  assertKnownKeys(manifest.endpoints, new Set(ENDPOINT_KEYS), 'endpoints')
  assertRequiredKeys(manifest.endpoints, ENDPOINT_KEYS, 'endpoints')
  for (const key of ENDPOINT_KEYS) {
    assertEndpoint(
      manifest.endpoints[key],
      `endpoints.${key}`,
      STRICT_HTTPS_ENDPOINTS.has(key),
      ORIGIN_ONLY_ENDPOINTS.has(key)
    )
  }

  assertObject(manifest.services, 'services')
  assertKnownKeys(manifest.services, SERVICE_GROUP_KEYS, 'services')
  assertRequiredKeys(manifest.services, SERVICE_KEYS, 'services')

  const api = manifest.services.api
  assertObject(api, 'services.api')
  assertKnownKeys(api, SERVICE_API_KEYS, 'services.api')
  assertRequiredKeys(api, SERVICE_API_KEYS, 'services.api')
  assertEndpoint(api.baseUrl, 'services.api.baseUrl')
  if (!api.baseUrl) {
    throw new Error('services.api.baseUrl is required')
  }

  const identity = manifest.services.identity
  assertObject(identity, 'services.identity')
  assertKnownKeys(identity, SERVICE_IDENTITY_KEYS, 'services.identity')
  assertRequiredKeys(identity, SERVICE_IDENTITY_KEYS, 'services.identity')
  assertEndpoint(identity.issuer, 'services.identity.issuer')
  if (!identity.issuer) {
    throw new Error('services.identity.issuer is required')
  }
  assertEndpoint(identity.userLoginUrl, 'services.identity.userLoginUrl')
  if (!identity.userLoginUrl) {
    throw new Error('services.identity.userLoginUrl is required')
  }
  assertObject(identity.clients, 'services.identity.clients')
  assertKnownKeys(identity.clients, SERVICE_IDENTITY_CLIENT_KEYS, 'services.identity.clients')
  assertRequiredKeys(identity.clients, SERVICE_IDENTITY_CLIENT_KEYS, 'services.identity.clients')
  for (const key of SERVICE_IDENTITY_CLIENT_KEYS) {
    assertNonEmptyString(identity.clients[key], `services.identity.clients.${key}`)
  }

  const oss = manifest.services.oss
  assertObject(oss, 'services.oss')
  assertKnownKeys(oss, SERVICE_OSS_KEYS, 'services.oss')
  assertRequiredKeys(oss, SERVICE_OSS_KEYS, 'services.oss')
  if (typeof oss.enabled !== 'boolean') {
    throw new Error('services.oss.enabled must be boolean')
  }
  assertOptionalString(oss.provider, 'services.oss.provider')
  assertEndpoint(oss.endpoint, 'services.oss.endpoint')
  if (oss.enabled && (!oss.endpoint || !oss.provider)) {
    throw new Error('services.oss requires endpoint and provider when enabled')
  }

  const update = manifest.services.update
  assertObject(update, 'services.update')
  assertKnownKeys(update, SERVICE_UPDATE_KEYS, 'services.update')
  assertRequiredKeys(update, SERVICE_UPDATE_KEYS, 'services.update')
  if (typeof update.enabled !== 'boolean') {
    throw new Error('services.update.enabled must be boolean')
  }
  assertEndpoint(update.endpoint, 'services.update.endpoint')
  assertEndpoint(update.checkEndpoint, 'services.update.checkEndpoint', true)
  assertEndpoint(update.artifactCdnOrigin, 'services.update.artifactCdnOrigin', true, true)
  if (
    update.checkEndpoint &&
    (() => {
      const parsed = new URL(update.checkEndpoint)
      return parsed.pathname.includes('%') || parsed.pathname !== HIVECLOUD_UPDATE_CHECK_PATH
    })()
  ) {
    throw new Error(
      `services.update.checkEndpoint must use the canonical ${HIVECLOUD_UPDATE_CHECK_PATH} path`
    )
  }
  if (update.enabled && !update.checkEndpoint) {
    throw new Error('services.update.checkEndpoint must be an HTTPS URL when enabled')
  }
  if (update.enabled && update.provider === 'hivecloud' && !update.artifactCdnOrigin) {
    throw new Error(
      'services.update.artifactCdnOrigin must be an HTTPS origin when HiveCloud updates are enabled'
    )
  }
  assertOptionalString(update.provider, 'services.update.provider')
  assertOptionalString(update.channel, 'services.update.channel')
  if (update.enabled && (!update.endpoint || !update.provider || !update.channel)) {
    throw new Error('services.update requires endpoint, provider and channel when enabled')
  }
  if (update.provider && !PRODUCT_UPDATE_PROVIDERS.has(update.provider)) {
    throw new Error('services.update.provider must be github, hivecloud, or null')
  }
  if (update.channel && !PRODUCT_UPDATE_CHANNELS.has(update.channel)) {
    throw new Error('services.update.channel must be internal, stable, beta, rc, or null')
  }
  if (
    !Number.isInteger(update.checkIntervalHours) ||
    update.checkIntervalHours < 1 ||
    update.checkIntervalHours > 168
  ) {
    throw new Error('services.update.checkIntervalHours must be an integer between 1 and 168')
  }

  // During the migration, keep populated legacy endpoint aliases aligned with
  // the canonical services block. Empty legacy values remain valid so older
  // manifests can be upgraded incrementally without reviving disabled services.
  const legacyServiceAliases = {
    cloud: api.baseUrl,
    identityIssuer: identity.issuer,
    update: update.enabled ? update.endpoint : null,
    artifacts: oss.enabled ? oss.endpoint : null
  }
  for (const [key, value] of Object.entries(legacyServiceAliases)) {
    const legacy = manifest.endpoints[key]
    if (legacy !== null && legacy !== undefined && legacy !== '' && legacy !== value) {
      throw new Error(`endpoints.${key} conflicts with services configuration`)
    }
  }
}

function nullableString(value) {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function quoteTypeScriptString(value) {
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\v', '\\v')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
    .replaceAll('\0', '\\0')}'`
}

function renderTypeScriptValue(value, level = 0) {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return quoteTypeScriptString(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    if (
      value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))
    ) {
      return `[${value.map((item) => renderTypeScriptValue(item, level + 1)).join(', ')}]`
    }
    const childIndent = '  '.repeat(level + 1)
    const closingIndent = '  '.repeat(level)
    return `[
${value.map((item) => `${childIndent}${renderTypeScriptValue(item, level + 1)}`).join(',\n')}
${closingIndent}]`
  }
  if (typeof value === 'object') {
    const childIndent = '  '.repeat(level + 1)
    const closingIndent = '  '.repeat(level)
    const entries = Object.entries(value).map(
      ([key, nested]) => `${childIndent}${key}: ${renderTypeScriptValue(nested, level + 1)}`
    )
    return `{
${entries.join(',\n')}
${closingIndent}}`
  }
  throw new Error(`Unsupported manifest value type: ${typeof value}`)
}

export function validateProductManifest(manifest) {
  assertProductManifest(manifest)
  return true
}

export function normalizeProductManifest(manifest) {
  validateProductManifest(manifest)
  return {
    schemaVersion: 1,
    displayName: manifest.displayName.trim(),
    shortName: manifest.shortName.trim(),
    slug: manifest.slug.trim(),
    branding: {
      logoAsset: manifest.branding.logoAsset.trim(),
      logoSha256: manifest.branding.logoSha256.trim()
    },
    publicLinks: Object.fromEntries(
      [...PUBLIC_LINK_KEYS].map((key) => [key, nullableString(manifest.publicLinks[key])])
    ),
    cli: {
      primary: manifest.cli.primary.trim(),
      aliases: manifest.cli.aliases.map((item) => item.trim())
    },
    schemes: {
      primary: manifest.schemes.primary.trim(),
      aliases: manifest.schemes.aliases.map((item) => item.trim())
    },
    desktop: {
      appId: nullableString(manifest.desktop.appId),
      executableName: manifest.desktop.executableName.trim(),
      publisher: nullableString(manifest.desktop.publisher),
      updateProvider: nullableString(manifest.desktop.updateProvider),
      updateChannel: nullableString(manifest.desktop.updateChannel),
      updateRepository: nullableString(manifest.desktop.updateRepository),
      starRepository: nullableString(manifest.desktop.starRepository)
    },
    mobile: {
      bundleId: nullableString(manifest.mobile.bundleId),
      packageId: nullableString(manifest.mobile.packageId)
    },
    endpoints: Object.fromEntries(
      ENDPOINT_KEYS.map((key) => [key, nullableString(manifest.endpoints[key])])
    ),
    services: {
      api: { baseUrl: manifest.services.api.baseUrl.trim() },
      identity: {
        issuer: manifest.services.identity.issuer.trim(),
        userLoginUrl: manifest.services.identity.userLoginUrl.trim(),
        clients: Object.fromEntries(
          [...SERVICE_IDENTITY_CLIENT_KEYS].map((key) => [
            key,
            manifest.services.identity.clients[key].trim()
          ])
        )
      },
      oss: {
        enabled: manifest.services.oss.enabled,
        endpoint: nullableString(manifest.services.oss.endpoint),
        provider: nullableString(manifest.services.oss.provider)
      },
      update: {
        enabled: manifest.services.update.enabled,
        endpoint: nullableString(manifest.services.update.endpoint),
        checkEndpoint: nullableString(manifest.services.update.checkEndpoint),
        artifactCdnOrigin: nullableString(manifest.services.update.artifactCdnOrigin),
        provider: nullableString(manifest.services.update.provider),
        channel: nullableString(manifest.services.update.channel),
        checkIntervalHours: manifest.services.update.checkIntervalHours
      }
    }
  }
}

export function renderProductConfigModule(manifest) {
  const normalized = normalizeProductManifest(manifest)
  return `// Generated by config/scripts/generate-product-config.mjs. Do not edit.\n\nexport const hivecodeProductConfig = ${renderTypeScriptValue(normalized)} as const\n\nexport type HiveCodeProductConfig = typeof hivecodeProductConfig\n`
}

function normalizeLineEndings(source) {
  return source.replace(/\r\n?/g, '\n')
}

export function generateProductConfig({ manifest, outputRoot = REPO_ROOT }) {
  const source = renderProductConfigModule(manifest)
  const files = GENERATED_RELATIVE_PATHS.map((relativePath) => path.join(outputRoot, relativePath))
  for (const filePath of files) {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, source, 'utf8')
  }
  return { files, manifest: normalizeProductManifest(manifest) }
}

function loadManifest(manifestPath) {
  return JSON.parse(readFileSync(manifestPath, 'utf8'))
}

export function checkProductConfig({ manifest, outputRoot = REPO_ROOT }) {
  const expected = renderProductConfigModule(manifest)
  const files = GENERATED_RELATIVE_PATHS.map((relativePath) => path.join(outputRoot, relativePath))
  const stale = files.filter((filePath) => {
    try {
      return normalizeLineEndings(readFileSync(filePath, 'utf8')) !== expected
    } catch {
      return true
    }
  })
  if (stale.length > 0) {
    throw new Error(`Generated product config is stale: ${stale.join(', ')}; run with --write`)
  }
  return files
}

function parseArgs(argv) {
  const options = { write: false, manifestPath: DEFAULT_MANIFEST_PATH }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--write') {
      options.write = true
    } else if (argument === '--check') {
      options.write = false
    } else if (argument === '--manifest') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('--manifest requires a value')
      }
      options.manifestPath = path.resolve(value)
      index += 1
    } else if (argument === '--help' || argument === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(
      'Usage: node config/scripts/generate-product-config.mjs [--write|--check] [--manifest <path>]\n'
    )
    return
  }
  const manifest = loadManifest(options.manifestPath)
  const result = options.write
    ? generateProductConfig({ manifest })
    : { files: checkProductConfig({ manifest }), manifest: normalizeProductManifest(manifest) }
  process.stdout.write(`${options.write ? 'Generated' : 'Verified'} ${result.files.join(', ')}\n`)
}

if (path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
