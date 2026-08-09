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
  'relay',
  'update',
  'telemetry',
  'diagnostics',
  'feedback',
  'pluginKillList',
  'pluginMarketplace',
  'changelog',
  'nudge'
]
const SECRET_KEY_PATTERN = /(secret|token|password|private.?key|api.?key|credential)/i
const CLI_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/
const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const GITHUB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/
const PRODUCT_UPDATE_CHANNELS = new Set(['stable', 'rc'])
const STRICT_HTTPS_ENDPOINTS = new Set(['artifacts', 'pluginMarketplace', 'changelog', 'nudge'])
const ORIGIN_ONLY_ENDPOINTS = new Set(['artifacts'])

const REQUIRED_ROOT_KEYS = [
  'schemaVersion',
  'displayName',
  'shortName',
  'slug',
  'cli',
  'schemes',
  'desktop',
  'mobile',
  'endpoints'
]
const ROOT_KEYS = new Set(['$schema', ...REQUIRED_ROOT_KEYS])
const DESKTOP_KEYS = new Set([
  'appId',
  'executableName',
  'publisher',
  'updateChannel',
  'updateRepository',
  'starRepository'
])
const MOBILE_KEYS = new Set(['bundleId', 'packageId'])
const CLI_KEYS = new Set(['primary', 'aliases'])
const SCHEME_KEYS = new Set(['primary', 'aliases'])

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
  if (
    parsed.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  ) {
    throw new Error(`${label} must use HTTPS unless it targets loopback`)
  }
}

function assertManifestShape(manifest) {
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
  assertAliasGroup(manifest.cli, 'cli', CLI_NAME_PATTERN)
  assertAliasGroup(manifest.schemes, 'schemes', SCHEME_PATTERN)

  assertObject(manifest.desktop, 'desktop')
  assertKnownKeys(manifest.desktop, DESKTOP_KEYS, 'desktop')
  assertRequiredKeys(manifest.desktop, DESKTOP_KEYS, 'desktop')
  assertOptionalString(manifest.desktop.appId, 'desktop.appId')
  assertNonEmptyString(manifest.desktop.executableName, 'desktop.executableName')
  assertOptionalString(manifest.desktop.publisher, 'desktop.publisher')
  assertOptionalString(manifest.desktop.updateChannel, 'desktop.updateChannel')
  if (
    manifest.desktop.updateChannel &&
    !PRODUCT_UPDATE_CHANNELS.has(manifest.desktop.updateChannel)
  ) {
    throw new Error('desktop.updateChannel must be stable, rc, or null')
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
  assertManifestShape(manifest)
  return true
}

export function normalizeProductManifest(manifest) {
  validateProductManifest(manifest)
  return {
    schemaVersion: 1,
    displayName: manifest.displayName.trim(),
    shortName: manifest.shortName.trim(),
    slug: manifest.slug.trim(),
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
    )
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
