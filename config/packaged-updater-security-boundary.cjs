const { createHash } = require('node:crypto')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const EXPECTED_ELECTRON_UPDATER_VERSION = '6.8.9'
const EXPECTED_BUILDER_UTIL_RUNTIME_VERSION = '9.7.0'

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

const REQUIRED_NULL_FIELDS = [
  'updateRepository',
  'updateChannel',
  'starRepository',
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
  }
]

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

  for (const authority of FORBIDDEN_MAIN_AUTHORITIES) {
    if (authority.pattern.test(source)) {
      throw new Error(`Packaged main contains forbidden upstream authority: ${authority.label}`)
    }
  }
}

function requireProductNullPolicy(source) {
  const missing = REQUIRED_NULL_FIELDS.filter(
    (field) => !new RegExp(`\\b${field}:\\s*null\\b`).test(source)
  )
  if (missing.length > 0) {
    throw new Error(`Packaged product config null policy is missing: ${missing.join(', ')}`)
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

function verifyPackagedUpdaterSecurityBoundary(
  resourcesDir,
  asar = require('@electron/asar')
) {
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
  const mainBundle = normalizeMainEntry(packageJson.main)
  const mainSource = extractAsarText(asar, asarPath, entries, mainBundle)
  const productConfigBundle = 'out/shared/generated/product-config.js'
  const productConfigSource = extractAsarText(
    asar,
    asarPath,
    entries,
    productConfigBundle
  )
  requireMainBundleMarkers(mainSource)
  requireProductNullPolicy(productConfigSource)
  const dependencyReport = verifyPackagedUpdaterDependencies(resourcesDir)

  return {
    passed: true,
    mainBundle,
    mainBundleSha256: createHash('sha256').update(mainSource).digest('hex'),
    productConfigBundle,
    productConfigBundleSha256: createHash('sha256').update(productConfigSource).digest('hex'),
    appAsarSha256: sha256File(asarPath),
    appUpdateYmlExists: false,
    ...dependencyReport
  }
}

module.exports = {
  EXPECTED_BUILDER_UTIL_RUNTIME_VERSION,
  EXPECTED_ELECTRON_UPDATER_VERSION,
  verifyPackagedUpdaterSecurityBoundary
}
