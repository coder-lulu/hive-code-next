const { createHash } = require('node:crypto')
const { existsSync, readFileSync } = require('node:fs')
const { join, posix } = require('node:path')
const { isDeepStrictEqual } = require('node:util')

const { $schema: _productSchema, ...EXPECTED_PRODUCT_CONFIG } = require(
  join(__dirname, 'product', 'hivecode.product.json')
)

const EXPECTED_ELECTRON_UPDATER_VERSION = '6.8.9'
const EXPECTED_BUILDER_UTIL_RUNTIME_VERSION = '9.7.0'
const EXPECTED_PRODUCT_LOGO_SHA256 =
  'd8440bc0b5c22e4f909fc3ad06a1bf3392c66029276e9a98b7cfa2a17ec8804d'
const EXPECTED_PACKAGED_APPLICATION_METADATA = {
  name: EXPECTED_PRODUCT_CONFIG.slug,
  productName: EXPECTED_PRODUCT_CONFIG.displayName,
  description: EXPECTED_PRODUCT_CONFIG.displayName,
  author: { name: EXPECTED_PRODUCT_CONFIG.displayName }
}

const REQUIRED_MAIN_LITERALS = [
  'installProductUpdaterHttpExecutorBoundary',
  'boundedRedirectHandlers',
  'boundedApiRequest',
  'boundedDownload',
  'sanitizeCrossOriginHeaders',
  'Too many updater redirects',
  'electron-updater HTTP executor is unavailable',
  '2147483648'
]

const REQUIRED_NULL_PATHS = [
  'desktop.publisher',
  'desktop.updateRepository',
  'desktop.updateChannel',
  'desktop.starRepository',
  'endpoints.artifacts',
  'endpoints.cloud',
  'endpoints.relay',
  'endpoints.update',
  'endpoints.telemetry',
  'endpoints.diagnostics',
  'endpoints.feedback',
  'endpoints.pluginKillList',
  'endpoints.pluginMarketplace',
  'endpoints.changelog',
  'endpoints.nudge',
  'publicLinks.website',
  'publicLinks.documentation',
  'publicLinks.support',
  'publicLinks.community',
  'publicLinks.social',
  'publicLinks.desktopDownload',
  'publicLinks.androidDownload',
  'publicLinks.iosDownload',
  'publicLinks.privacyPolicy',
  'publicLinks.termsOfService'
]

const FORBIDDEN_MAIN_AUTHORITIES = [
  {
    label: 'upstream plugin marketplace',
    pattern: /https:\/\/github\.com\/stablyai\/orca-plugins\.git/i
  },
  {
    label: 'upstream star repository',
    pattern: /(["'])stablyai\/orca\1/
  },
  {
    label: 'upstream GitHub API repository',
    pattern: /https:\/\/api\.github\.com\/repos\/stablyai\/orca(?:[/?#]|$)/i
  },
  {
    label: 'upstream source repository',
    pattern: /https:\/\/github\.com\/stablyai\/orca(?:[/?#'"`]|$)/i
  }
]

const FORBIDDEN_RENDERER_AUTHORITIES = [
  {
    label: 'upstream source repository',
    pattern: /https:\/\/github\.com\/stablyai\/orca(?:[/?#"']|$)/i
  },
  { label: 'upstream website', pattern: /https:\/\/(?:www\.)?onorca\.dev(?:[/?#"']|$)/i },
  { label: 'upstream community invite', pattern: /https:\/\/discord\.gg\/fzjDKHxv8Q/i },
  { label: 'upstream social account', pattern: /https:\/\/(?:www\.)?x\.com\/orca_build/i }
]

const LEGACY_ORCA_LOGO_FINGERPRINTS = ['viewBox="0 0 318.60232 202.66667"', '177.81311,248.33334']
const ALLOWED_RENDERER_COMPATIBILITY_AUTHORITY_PATTERN =
  /https:\/\/github\.com\/stablyai\/orca(?=["'])/g

const RENDERER_TEXT_ENTRY_PATTERN = /^out\/renderer\/.*\.(?:css|html|js|json|svg)$/i
const RENDERER_IMAGE_ENTRY_PATTERN = /^out\/renderer\/.*\.(?:jpe?g|png|svg|webp)$/i
const PUBLIC_RUNTIME_TEXT_ENTRY_PATTERN =
  /^out\/(?:renderer|web|shared)\/.*\.(?:css|html|c?js|mjs|json|svg)$/i
const MAIN_TEXT_ENTRY_PATTERN = /^out\/main\/.*\.(?:c?js|mjs|json)$/i
const MAIN_PRODUCT_CONFIG_ENTRY_PATTERN =
  /^out\/main\/chunks\/(?:brand|product-config)-[^/]+\.(?:c?js|mjs)$/i

function normalizeAsarEntryPath(entry) {
  return entry.replace(/\\/g, '/').replace(/^\/+/, '')
}

function findAsarEntry(entries, expectedPath) {
  return entries.find((entry) => normalizeAsarEntryPath(entry) === expectedPath)
}

function extractAsarText(asar, asarPath, entries, expectedPath) {
  const entry = findAsarEntry(entries, expectedPath)
  if (!entry) {
    throw new Error(`Packaged asar entry ${expectedPath} was not found in ${asarPath}`)
  }
  return asar.extractFile(asarPath, entry.replace(/^[\\/]+/, '')).toString('utf8')
}

function parseJsonFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Packaged ${label} is missing at ${path}`)
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Packaged ${label} is invalid JSON: ${message}`)
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function normalizeMainEntry(main) {
  if (typeof main !== 'string' || main.trim() === '') {
    throw new Error('Packaged app package.json must declare a non-empty main entry')
  }
  const normalized = main.replace(/\\/g, '/').replace(/^\.\//, '')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Packaged app main entry is unsafe: ${main}`)
  }
  return normalized
}

function resolveMainProductConfigBundle(entries, mainBundle, mainSource) {
  const candidates = entries
    .map(normalizeAsarEntryPath)
    .filter((entry) => MAIN_PRODUCT_CONFIG_ENTRY_PATTERN.test(entry))
  if (candidates.length !== 1) {
    throw new Error(
      `Packaged Main must contain exactly one runtime product config chunk (found ${candidates.length})`
    )
  }
  const productConfigBundle = candidates[0]
  const relativeRequirePath = `./${posix.relative(posix.dirname(mainBundle), productConfigBundle)}`
  const escapedRequirePath = relativeRequirePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const staticRequirePattern = new RegExp(`require\\(\\s*(["'])${escapedRequirePath}\\1\\s*\\)`)
  if (!staticRequirePattern.test(mainSource)) {
    throw new Error(
      `Packaged Main entry does not statically require its runtime product config: ${relativeRequirePath}`
    )
  }
  return productConfigBundle
}

function requireMainAuthorityBoundary(source, entry) {
  for (const authority of FORBIDDEN_MAIN_AUTHORITIES) {
    if (authority.pattern.test(source)) {
      throw new Error(
        `Packaged main contains forbidden upstream authority in ${entry}: ${authority.label}`
      )
    }
  }
}

function requireMainBundleMarkers(source) {
  const missing = REQUIRED_MAIN_LITERALS.filter((marker) => !source.includes(marker))
  if (!/\.fromPartition\(["']electron-updater["'],\s*\{\s*cache:\s*false\s*\}\)/.test(source)) {
    missing.push('dedicated electron-updater session partition')
  }
  if (!/autoInstallOnAppQuit\s*=\s*false/.test(source)) {
    missing.push('autoInstallOnAppQuit=false')
  }
  if (missing.length > 0) {
    throw new Error(`Packaged main updater security markers are missing: ${missing.join(', ')}`)
  }
}

function skipStaticWhitespace(source, state) {
  while (state.index < source.length) {
    if (/\s/.test(source[state.index])) {
      state.index += 1
      continue
    }
    if (source.startsWith('//', state.index)) {
      const newline = source.indexOf('\n', state.index + 2)
      state.index = newline === -1 ? source.length : newline + 1
      continue
    }
    if (source.startsWith('/*', state.index)) {
      const end = source.indexOf('*/', state.index + 2)
      if (end === -1) {
        throw new Error('Unterminated comment in packaged product config')
      }
      state.index = end + 2
      continue
    }
    break
  }
}

function parseStaticString(source, state) {
  const quote = source[state.index]
  if (quote !== '"' && quote !== "'") {
    throw new Error(`Expected a string at offset ${state.index}`)
  }
  state.index += 1
  let value = ''
  while (state.index < source.length) {
    const character = source[state.index++]
    if (character === quote) {
      return value
    }
    if (character !== '\\') {
      value += character
      continue
    }
    const escaped = source[state.index++]
    const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }
    if (escapes[escaped] !== undefined) {
      value += escapes[escaped]
    } else if (escaped === 'u') {
      value += String.fromCharCode(Number.parseInt(source.slice(state.index, state.index + 4), 16))
      state.index += 4
    } else if (escaped === 'x') {
      value += String.fromCharCode(Number.parseInt(source.slice(state.index, state.index + 2), 16))
      state.index += 2
    } else {
      value += escaped
    }
  }
  throw new Error('Unterminated string in packaged product config')
}

function parseStaticIdentifier(source, state) {
  const start = state.index
  while (/[A-Za-z0-9_$]/.test(source[state.index] ?? '')) {
    state.index += 1
  }
  if (state.index === start) {
    throw new Error(`Expected an identifier at offset ${state.index}`)
  }
  return source.slice(start, state.index)
}

function parseStaticValue(source, state) {
  skipStaticWhitespace(source, state)
  const character = source[state.index]
  if (character === '{') {
    return parseStaticObject(source, state)
  }
  if (character === '[') {
    state.index += 1
    const values = []
    skipStaticWhitespace(source, state)
    while (source[state.index] !== ']') {
      values.push(parseStaticValue(source, state))
      skipStaticWhitespace(source, state)
      if (source[state.index] === ',') {
        state.index += 1
        skipStaticWhitespace(source, state)
      } else if (source[state.index] !== ']') {
        throw new Error(`Expected ',' or ']' at offset ${state.index}`)
      }
    }
    state.index += 1
    return values
  }
  if (character === '"' || character === "'") {
    return parseStaticString(source, state)
  }
  if (source.startsWith('null', state.index)) {
    state.index += 4
    return null
  }
  if (source.startsWith('true', state.index)) {
    state.index += 4
    return true
  }
  if (source.startsWith('false', state.index)) {
    state.index += 5
    return false
  }
  const number = source.slice(state.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
  if (number) {
    state.index += number[0].length
    return Number(number[0])
  }
  throw new Error(`Unsupported product config value at offset ${state.index}`)
}

function parseStaticObject(source, state) {
  if (source[state.index] !== '{') {
    throw new Error(`Expected an object at offset ${state.index}`)
  }
  state.index += 1
  const value = {}
  skipStaticWhitespace(source, state)
  while (source[state.index] !== '}') {
    const key =
      source[state.index] === '"' || source[state.index] === "'"
        ? parseStaticString(source, state)
        : parseStaticIdentifier(source, state)
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`Duplicate product config key: ${key}`)
    }
    skipStaticWhitespace(source, state)
    if (source[state.index] !== ':') {
      throw new Error(`Expected ':' after product config key ${key}`)
    }
    state.index += 1
    value[key] = parseStaticValue(source, state)
    skipStaticWhitespace(source, state)
    if (source[state.index] === ',') {
      state.index += 1
      skipStaticWhitespace(source, state)
    } else if (source[state.index] !== '}') {
      throw new Error(`Expected ',' or '}' at offset ${state.index}`)
    }
  }
  state.index += 1
  return value
}

function parsePackagedProductConfig(source) {
  const directAssignments = [...source.matchAll(/\bexports\.hivecodeProductConfig\s*=\s*(?=\{)/g)]
  const bundledDeclarations = [
    ...source.matchAll(/\b(?:const|let|var)\s+hivecodeProductConfig\s*=\s*(?=\{)/g)
  ]
  const candidates = [...directAssignments, ...bundledDeclarations]
  if (candidates.length !== 1) {
    throw new Error(
      `Packaged product config must contain exactly one static config (found ${candidates.length})`
    )
  }

  if (bundledDeclarations.length === 1) {
    const bundledExportPattern =
      /Object\.defineProperty\(\s*exports\s*,\s*["']hivecodeProductConfig["']\s*,[\s\S]*?\bget\s*:\s*function\s*\([^)]*\)\s*\{\s*return\s+hivecodeProductConfig\s*;?\s*\}/
    if (!bundledExportPattern.test(source)) {
      throw new Error(
        'Packaged product config declaration is not exported through the expected static getter'
      )
    }
  }

  const state = { index: candidates[0].index + candidates[0][0].length }
  return parseStaticValue(source, state)
}

function getConfigPath(config, path) {
  return path.split('.').reduce((value, key) => value?.[key], config)
}

function requireProductNullPolicy(config) {
  const missing = REQUIRED_NULL_PATHS.filter((path) => getConfigPath(config, path) !== null)
  if (missing.length > 0) {
    throw new Error(`Packaged product config null policy is missing: ${missing.join(', ')}`)
  }
  if (!isDeepStrictEqual(config, EXPECTED_PRODUCT_CONFIG)) {
    throw new Error('Packaged product config does not match the canonical product manifest')
  }
}

function requirePackagedApplicationMetadata(packageJson) {
  const actual = {
    name: packageJson.name,
    productName: packageJson.productName,
    description: packageJson.description,
    author: packageJson.author
  }
  if (!isDeepStrictEqual(actual, EXPECTED_PACKAGED_APPLICATION_METADATA)) {
    throw new Error('Packaged application metadata does not match the canonical product identity')
  }
  return actual
}

function extractAsarBuffer(asar, asarPath, entry) {
  return asar.extractFile(asarPath, entry.replace(/^[\\/]+/, ''))
}

function verifyPackagedRendererBrandBoundary(asar, asarPath, entries) {
  const rendererTextEntries = entries.filter((entry) =>
    RENDERER_TEXT_ENTRY_PATTERN.test(normalizeAsarEntryPath(entry))
  )
  if (rendererTextEntries.length === 0) {
    throw new Error(`Packaged renderer text entries were not found in ${asarPath}`)
  }

  const rendererSource = rendererTextEntries
    .map((entry) => extractAsarBuffer(asar, asarPath, entry).toString('utf8'))
    .join('\n')
  if (!rendererSource.includes('HiveCode')) {
    throw new Error('Packaged renderer is missing the HiveCode product name marker')
  }

  const publicRuntimeTextEntries = entries.filter((entry) =>
    PUBLIC_RUNTIME_TEXT_ENTRY_PATTERN.test(normalizeAsarEntryPath(entry))
  )
  const publicRuntimeSource = publicRuntimeTextEntries
    .map((entry) => extractAsarBuffer(asar, asarPath, entry).toString('utf8'))
    .join('\n')
  const inspectedPublicRuntimeSource = publicRuntimeSource.replace(
    ALLOWED_RENDERER_COMPATIBILITY_AUTHORITY_PATTERN,
    '[upstream-skills-compatibility-source]'
  )
  for (const authority of FORBIDDEN_RENDERER_AUTHORITIES) {
    if (authority.pattern.test(inspectedPublicRuntimeSource)) {
      throw new Error(
        `Packaged public runtime contains forbidden upstream authority: ${authority.label}`
      )
    }
  }
  for (const fingerprint of LEGACY_ORCA_LOGO_FINGERPRINTS) {
    if (rendererSource.includes(fingerprint)) {
      throw new Error(`Packaged renderer contains legacy Orca logo fingerprint: ${fingerprint}`)
    }
  }

  let approvedProductLogoEntry = null
  for (const entry of entries) {
    const normalized = normalizeAsarEntryPath(entry)
    if (!RENDERER_IMAGE_ENTRY_PATTERN.test(normalized)) {
      continue
    }
    const digest = createHash('sha256')
      .update(extractAsarBuffer(asar, asarPath, entry))
      .digest('hex')
    if (digest === EXPECTED_PRODUCT_LOGO_SHA256) {
      approvedProductLogoEntry = normalized
      break
    }
  }
  if (!approvedProductLogoEntry) {
    throw new Error(
      `Packaged renderer does not contain the approved HiveCode product logo (${EXPECTED_PRODUCT_LOGO_SHA256})`
    )
  }

  return {
    rendererBrandMarker: 'HiveCode',
    rendererTextEntryCount: rendererTextEntries.length,
    publicRuntimeTextEntryCount: publicRuntimeTextEntries.length,
    approvedProductLogoEntry,
    approvedProductLogoSha256: EXPECTED_PRODUCT_LOGO_SHA256
  }
}

function requireDependencySourceMarkers(source, markers, label) {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) {
    throw new Error(`Packaged ${label} callback contract is missing: ${missing.join(', ')}`)
  }
}

function verifyPackagedUpdaterDependencies(resourcesDir) {
  const electronUpdaterDir = join(resourcesDir, 'node_modules', 'electron-updater')
  const builderUtilRuntimeDir = join(resourcesDir, 'node_modules', 'builder-util-runtime')
  const electronUpdaterPackagePath = join(electronUpdaterDir, 'package.json')
  const builderUtilRuntimePackagePath = join(builderUtilRuntimeDir, 'package.json')
  const electronUpdaterPackage = parseJsonFile(
    electronUpdaterPackagePath,
    'electron-updater package.json'
  )
  const builderUtilRuntimePackage = parseJsonFile(
    builderUtilRuntimePackagePath,
    'builder-util-runtime package.json'
  )

  if (electronUpdaterPackage.version !== EXPECTED_ELECTRON_UPDATER_VERSION) {
    throw new Error(
      `Unexpected packaged electron-updater version: ${electronUpdaterPackage.version ?? 'missing'}`
    )
  }
  if (
    electronUpdaterPackage.dependencies?.['builder-util-runtime'] !==
    EXPECTED_BUILDER_UTIL_RUNTIME_VERSION
  ) {
    throw new Error('Packaged electron-updater does not pin builder-util-runtime 9.7.0')
  }
  if (builderUtilRuntimePackage.version !== EXPECTED_BUILDER_UTIL_RUNTIME_VERSION) {
    throw new Error(
      `Unexpected packaged builder-util-runtime version: ${builderUtilRuntimePackage.version ?? 'missing'}`
    )
  }

  const electronHttpExecutorPath = join(electronUpdaterDir, 'out', 'electronHttpExecutor.js')
  const electronHttpExecutorSource = readFileSync(electronHttpExecutorPath, 'utf8')
  requireDependencySourceMarkers(
    electronHttpExecutorSource,
    [
      'function getNetSession()',
      'createRequest(options, callback)',
      'this.cachedSession = getNetSession()',
      'addRedirectHandlers(request, options, reject, redirectCount, handler)',
      'request.on("redirect"',
      'handler(builder_util_runtime_1.HttpExecutor.prepareRedirectUrlOptions'
    ],
    'electron-updater ElectronHttpExecutor'
  )

  const httpExecutorPath = join(builderUtilRuntimeDir, 'out', 'httpExecutor.js')
  const httpExecutorSource = readFileSync(httpExecutorPath, 'utf8')
  requireDependencySourceMarkers(
    httpExecutorSource,
    [
      'doApiRequest(options',
      'doDownload(',
      'this.addRedirectHandlers(',
      'static prepareRedirectUrlOptions('
    ],
    'builder-util-runtime HttpExecutor'
  )

  return {
    electronUpdaterVersion: electronUpdaterPackage.version,
    builderUtilRuntimeVersion: builderUtilRuntimePackage.version,
    electronUpdaterPackageSha256: sha256File(electronUpdaterPackagePath),
    electronHttpExecutorSha256: sha256File(electronHttpExecutorPath),
    builderUtilRuntimePackageSha256: sha256File(builderUtilRuntimePackagePath),
    builderUtilRuntimeHttpExecutorSha256: sha256File(httpExecutorPath)
  }
}

function verifyPackagedUpdaterSecurityBoundary(resourcesDir, asar = require('@electron/asar')) {
  const asarPath = join(resourcesDir, 'app.asar')
  if (!existsSync(asarPath)) {
    throw new Error(`Packaged app.asar is missing at ${asarPath}`)
  }
  const appUpdateYmlPath = join(resourcesDir, 'app-update.yml')
  if (existsSync(appUpdateYmlPath)) {
    throw new Error('Packaged app-update.yml is forbidden while product updates are disabled')
  }

  const entries = asar.listPackage(asarPath)
  const packageJson = JSON.parse(extractAsarText(asar, asarPath, entries, 'package.json'))
  const packagedApplicationMetadata = requirePackagedApplicationMetadata(packageJson)
  const mainBundle = normalizeMainEntry(packageJson.main)
  const mainSource = extractAsarText(asar, asarPath, entries, mainBundle)
  const mainTextEntries = entries.filter((entry) =>
    MAIN_TEXT_ENTRY_PATTERN.test(normalizeAsarEntryPath(entry))
  )
  if (mainTextEntries.length === 0) {
    throw new Error(`Packaged main text entries were not found in ${asarPath}`)
  }
  const productConfigBundle = resolveMainProductConfigBundle(entries, mainBundle, mainSource)
  const productConfigSource = extractAsarText(asar, asarPath, entries, productConfigBundle)
  const generatedProductConfigBundle = 'out/shared/generated/product-config.js'
  const generatedProductConfigSource = extractAsarText(
    asar,
    asarPath,
    entries,
    generatedProductConfigBundle
  )
  requireMainBundleMarkers(mainSource)
  for (const entry of mainTextEntries) {
    requireMainAuthorityBoundary(
      extractAsarBuffer(asar, asarPath, entry).toString('utf8'),
      normalizeAsarEntryPath(entry)
    )
  }
  const productConfig = parsePackagedProductConfig(productConfigSource)
  requireProductNullPolicy(productConfig)
  const generatedProductConfig = parsePackagedProductConfig(generatedProductConfigSource)
  requireProductNullPolicy(generatedProductConfig)
  const rendererBrandReport = verifyPackagedRendererBrandBoundary(asar, asarPath, entries)
  const dependencyReport = verifyPackagedUpdaterDependencies(resourcesDir)

  return {
    passed: true,
    mainBundle,
    mainTextEntryCount: mainTextEntries.length,
    mainBundleSha256: createHash('sha256').update(mainSource).digest('hex'),
    packagedApplicationMetadata,
    productConfigBundle,
    productConfigBundleSha256: createHash('sha256').update(productConfigSource).digest('hex'),
    generatedProductConfigBundle,
    generatedProductConfigBundleSha256: createHash('sha256')
      .update(generatedProductConfigSource)
      .digest('hex'),
    appAsarSha256: sha256File(asarPath),
    appUpdateYmlExists: false,
    ...rendererBrandReport,
    ...dependencyReport
  }
}

module.exports = {
  EXPECTED_BUILDER_UTIL_RUNTIME_VERSION,
  EXPECTED_ELECTRON_UPDATER_VERSION,
  EXPECTED_PRODUCT_LOGO_SHA256,
  verifyPackagedUpdaterSecurityBoundary
}
