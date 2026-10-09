import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  javascriptInventory,
  packReleaseJavascript,
  releaseBuildIdentity,
  releaseJavascriptConfiguration,
  restoreReleaseJavascript
} from './release-javascript-artifact.mjs'
import { releaseJavascriptSupport } from './release-javascript-support.mjs'
import { runProcessSync, describeProcessFailure } from './script-child-process.mjs'

const directories = []
const configuration = {
  sourceSha: 'a'.repeat(40),
  version: '1.2.3-rc.4',
  packageManager: 'pnpm@12.8.1',
  identity: 'rc',
  diagnosticsTokenUrl: 'https://example.test/diagnostics',
  telemetryEndpoint: 'https://example.test/telemetry',
  telemetryKeySha256: 'b'.repeat(64)
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture() {
  const fixtureDirectory = join(process.cwd(), 'logs', 'release-javascript-tests')
  mkdirSync(fixtureDirectory, { recursive: true })
  const root = mkdtempSync(join(fixtureDirectory, 'artifact-'))
  directories.push(root)
  for (const file of [
    'cli/index.js',
    'main/index.js',
    'preload/index.js',
    'renderer/index.html',
    'renderer/.vite/manifest.json',
    'web/web-index.html',
    'mobile-web/manifest.json',
    'package.json',
    'renderer/wasm/viewer.wasm',
    'main/index.js.map'
  ]) {
    const destination = join(root, 'out', file)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, file === 'cli/index.js' ? '#!/usr/bin/env node\n' : file)
  }
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      version: configuration.version,
      packageManager: configuration.packageManager,
      scripts: { 'build:release:javascript': 'compile', 'build:release:host': 'host' }
    })
  )
  const artifactDir = join(root, '.build', 'artifact')
  return { root, artifactDir, configuration }
}

describe('release JavaScript transfer', () => {
  it('preserves hidden manifests, source maps and portable WASM while replacing stale outputs', () => {
    const options = fixture()
    const before = javascriptInventory(join(options.root, 'out'))
    packReleaseJavascript(options)
    writeFileSync(join(options.root, 'out', 'stale.js'), 'old')
    restoreReleaseJavascript(options)
    expect(javascriptInventory(join(options.root, 'out'))).toEqual(before)
  })

  it.each([
    'sourceSha',
    'version',
    'packageManager',
    'identity',
    'diagnosticsTokenUrl',
    'telemetryEndpoint',
    'telemetryKeySha256'
  ])('rejects a different %s before replacing the current build', (field) => {
    const options = fixture()
    packReleaseJavascript(options)
    expect(() =>
      restoreReleaseJavascript({
        ...options,
        configuration: { ...configuration, [field]: 'different' }
      })
    ).toThrow('JavaScript build configuration differs')
    expect(readFileSync(join(options.root, 'out', 'main', 'index.js'), 'utf8')).toBe(
      'main/index.js'
    )
  })

  it('rejects a damaged archive before replacing the current build', () => {
    const options = fixture()
    packReleaseJavascript(options)
    writeFileSync(join(options.artifactDir, 'release-javascript.tar.gz'), 'damaged')
    expect(() => restoreReleaseJavascript(options)).toThrow('JavaScript archive differs')
    expect(readFileSync(join(options.root, 'out', 'main', 'index.js'), 'utf8')).toBe(
      'main/index.js'
    )
  })

  it('rejects a file inventory that no longer describes the archive', () => {
    const options = fixture()
    const manifest = packReleaseJavascript(options)
    manifest.files[0].sha256 = 'c'.repeat(64)
    writeFileSync(join(options.artifactDir, 'manifest.json'), JSON.stringify(manifest))
    expect(() => restoreReleaseJavascript(options)).toThrow('JavaScript file inventory differs')
  })

  it.each([
    'addon.node',
    'launcher.exe',
    'library.dll',
    'library.dylib',
    'library.so.1',
    'relay/relay.js'
  ])('keeps %s out of the portable artifact', (file) => {
    const options = fixture()
    const destination = join(options.root, 'out', file)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, 'host output')
    expect(() => packReleaseJavascript(options)).toThrow(/native binary|host output/)
  })

  it.skipIf(process.platform === 'win32')(
    'rejects symlinks instead of following files outside the build',
    () => {
      const options = fixture()
      symlinkSync(
        join(options.root, 'out', 'main', 'index.js'),
        join(options.root, 'out', 'linked.js')
      )
      expect(() => packReleaseJavascript(options)).toThrow('contains a symlink')
    }
  )

  it('refuses incomplete build output', () => {
    const options = fixture()
    rmSync(join(options.root, 'out', 'preload', 'index.js'))
    expect(() => packReleaseJavascript(options)).toThrow(
      'Missing JavaScript output: preload/index.js'
    )
  })

  it('classifies stable and suffixed RC versions and rejects other tag families', () => {
    expect(releaseBuildIdentity('v1.2.3')).toBe('stable')
    expect(releaseBuildIdentity('v1.2.3-rc.4.perf')).toBe('rc')
    expect(releaseBuildIdentity('v1.5.0-beta.24')).toBe('rc')
    expect(() => releaseBuildIdentity('v1.5.0-beta.24.perf')).toThrow('Invalid desktop release tag')
    expect(() => releaseBuildIdentity('mobile-v1.2.3')).toThrow('Invalid desktop release tag')
  })
})

function configurationFixture(endpoints = { diagnostics: null, telemetry: null }) {
  const { root } = fixture()
  const manifestDirectory = join(root, 'config', 'product')
  mkdirSync(manifestDirectory, { recursive: true })
  writeFileSync(join(manifestDirectory, 'hivecode.product.json'), JSON.stringify({ endpoints }))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      version: '1.5.0-beta.24',
      packageManager: 'pnpm@12.8.1',
      scripts: { 'build:release:javascript': 'compile', 'build:release:host': 'host' }
    })
  )
  for (const args of [
    ['init', '--quiet'],
    [
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'fixture'
    ]
  ]) {
    const result = runProcessSync({ program: 'git', args, cwd: root, timeoutMs: 30_000 })
    expect(result.code, describeProcessFailure(result)).toBe(0)
  }
  return root
}

describe('HiveCode JavaScript release service configuration', () => {
  it('roundtrips a beta release with both external services disabled and no foreign secrets', () => {
    const root = configurationFixture()
    const config = releaseJavascriptConfiguration(root, { ORCA_BUILD_IDENTITY: 'rc' })
    expect(config).toMatchObject({
      version: '1.5.0-beta.24',
      identity: 'rc',
      diagnosticsTokenUrl: null,
      telemetryEndpoint: null,
      telemetryKeySha256: null
    })
    const artifactDir = join(root, '.build', 'nullable-artifact')
    packReleaseJavascript({ root, artifactDir, configuration: config })
    restoreReleaseJavascript({ root, artifactDir, configuration: config })
  })

  it('refuses a foreign diagnostics endpoint when product diagnostics are unavailable', () => {
    const root = configurationFixture()
    expect(() =>
      releaseJavascriptConfiguration(root, {
        ORCA_BUILD_IDENTITY: 'rc',
        ORCA_DIAGNOSTICS_TOKEN_URL: 'https://www.onorca.dev/diagnostics/token'
      })
    ).toThrow('Release diagnostics URL differs from product configuration')
  })

  it('refuses a telemetry key when the product has no telemetry endpoint', () => {
    const root = configurationFixture()
    expect(() =>
      releaseJavascriptConfiguration(root, {
        ORCA_BUILD_IDENTITY: 'rc',
        ORCA_POSTHOG_WRITE_KEY: 'phc_foreign'
      })
    ).toThrow('Product telemetry is disabled')
  })

  it('requires credentials for a configured product telemetry service', () => {
    const root = configurationFixture({
      diagnostics: null,
      telemetry: 'https://telemetry.example.test'
    })
    expect(() => releaseJavascriptConfiguration(root, { ORCA_BUILD_IDENTITY: 'rc' })).toThrow(
      'Missing configured product telemetry key'
    )
  })

  it('binds enabled service configuration into the exact artifact transfer identity', () => {
    const endpoints = {
      diagnostics: 'https://diagnostics.example.test/token',
      telemetry: 'https://telemetry.example.test'
    }
    const root = configurationFixture(endpoints)
    const config = releaseJavascriptConfiguration(root, {
      ORCA_BUILD_IDENTITY: 'rc',
      ORCA_DIAGNOSTICS_TOKEN_URL: endpoints.diagnostics,
      ORCA_POSTHOG_WRITE_KEY: 'phc_owned'
    })
    expect(config.diagnosticsTokenUrl).toBe(endpoints.diagnostics)
    expect(config.telemetryEndpoint).toBe(endpoints.telemetry)
    expect(config.telemetryKeySha256).toMatch(/^[a-f0-9]{64}$/)
    const artifactDir = join(root, '.build', 'owned-artifact')
    packReleaseJavascript({ root, artifactDir, configuration: config })
    expect(() =>
      restoreReleaseJavascript({
        root,
        artifactDir,
        configuration: { ...config, telemetryEndpoint: 'https://foreign.example.test' }
      })
    ).toThrow('JavaScript build configuration differs')
  })
})

it('excludes host native Pi slots and their extensionless or executable runtimes from portable transfer', () => {
  const options = fixture()
  for (const file of [
    'linux-x64/node',
    'win32-x64/node.exe',
    'darwin-arm64/node_modules/addon.node'
  ]) {
    const destination = join(options.root, 'out', 'native-pi', file)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, 'host-specific runtime')
  }
  const manifest = packReleaseJavascript(options)
  expect(manifest.files.some((file) => file.path.startsWith('native-pi/'))).toBe(false)
  restoreReleaseJavascript(options)
  expect(javascriptInventory(join(options.root, 'out'))).toEqual(manifest.files)
})

it('refuses a foreign host native Pi slot in a purported portable archive inventory', () => {
  const options = fixture()
  const directory = join(options.root, 'out', 'native-pi', 'linux-x64')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'node'), 'extensionless foreign executable')
  expect(() => javascriptInventory(join(options.root, 'out'))).toThrow('host output')
})

it('allows a genuinely portable source while refusing host-bound Pack trust even with forced artifact configuration', () => {
  const options = fixture()
  expect(releaseJavascriptSupport(options.root)).toEqual({ supported: true, reason: '' })
  packReleaseJavascript(options)
  writeFileSync(
    join(options.root, 'electron.vite.config.ts'),
    'const plugins = [createManagedPiPackBuildPlugin(resolve("."))];'
  )
  mkdirSync(join(options.root, 'config', 'build-plugins'), { recursive: true })
  writeFileSync(
    join(options.root, 'config', 'build-plugins', 'managed-pi-pack-build.ts'),
    'const define = { HIVECODE_MANAGED_PI_PACK_TRUST: JSON.stringify({ [pack.directoryKey]: pack.indexSha256 }) };'
  )
  expect(releaseJavascriptSupport(options.root)).toMatchObject({ supported: false })
  expect(() => packReleaseJavascript(options)).toThrow('Full per-platform builds are required')
  expect(() => restoreReleaseJavascript(options)).toThrow('Full per-platform builds are required')
  expect(readFileSync(join(options.root, 'out', 'main', 'index.js'), 'utf8')).toBe('main/index.js')
})
