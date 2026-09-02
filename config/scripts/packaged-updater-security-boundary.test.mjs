import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  verifyPackagedUpdaterSecurityBoundary
} = require('../packaged-updater-security-boundary.cjs')

const roots = []

function validMainBundle(
  runtimeProductConfigChunkName = 'product-config-fixture.js',
  runtimeProductConfigExportName = 'hivecodeProductConfig'
) {
  return `
    const runtimeProductConfig = require("./chunks/${runtimeProductConfigChunkName}")
    void runtimeProductConfig.${runtimeProductConfigExportName}
    installProductUpdaterHttpExecutorBoundary(executor)
    executor.addRedirectHandlers = function boundedRedirectHandlers() {}
    executor.doApiRequest = function boundedApiRequest() {}
    executor.doDownload = function boundedDownload() {}
    electron.session.fromPartition(\`electron-updater\`, { cache: !1 })
    autoUpdater.autoInstallOnAppQuit = !1
    executor.request = function boundedRequest() {}
    const updaterHeaderAllowlist = new Set([\`accept\`, \`accept-encoding\`, \`cache-control\`, \`pragma\`, \`user-agent\`])
    const MAX_UPDATER_ARTIFACT_BYTES = 2147483648
    const config = {
      updateRepository: null,
      updateProvider: 'hivecloud',
      updateChannel: 'beta',
      starRepository: null,
      update: 'https://updates.hive.test/hive/v1/updates/desktop/',
      telemetry: null,
      diagnostics: null,
      pluginMarketplace: null
    }
    sanitizeCrossOriginHeaders(headers)
    throw new Error("Updater HTTP executor redirect handler is unavailable")
    throw new Error("Updater metadata POST requests are not allowed")
    throw new Error("Updater request is outside the active update feed")
    throw new Error("Updater redirect is outside the product network boundary")
    throw new Error("Too many updater redirects")
    throw new Error("electron-updater HTTP executor is unavailable")
  `
}

function validProductConfig() {
  return `
    exports.hivecodeProductConfig = {
      schemaVersion: 1,
      displayName: 'HiveCode',
      shortName: 'HiveCode',
      slug: 'hivecode',
      branding: {
        logoAsset: 'resources/product-logo.png',
        logoSha256: '46325bf9d05755d2b412f0a2e720cb1944d69abb7f6e3c07b59ed304f4e81950'
      },
      publicLinks: {
        website: null,
        documentation: null,
        support: null,
        community: null,
        social: null,
        desktopDownload: null,
        androidDownload: null,
        iosDownload: null,
        privacyPolicy: null,
        termsOfService: null
      },
      cli: { primary: 'hive', aliases: ['hivecode', 'orca', 'orca-ide'] },
      schemes: { primary: 'hivecode', aliases: ['orca'] },
      desktop: {
        appId: 'com.hivekernel.hivecode.desktop',
        executableName: 'HiveCode',
        publisher: null,
        updateProvider: 'hivecloud',
        updateChannel: 'beta',
        updateRepository: null,
        starRepository: null
      },
      mobile: {
        bundleId: 'com.hivekernel.hivecode.mobile',
        packageId: 'com.hivekernel.hivecode.mobile'
      },
      endpoints: {
        artifacts: null,
        cloud: 'https://api.hive.test',
        identityIssuer: 'https://identity.hive.test/realms/hive',
        relay: null,
        update: 'https://updates.hive.test/hive/v1/updates/desktop/',
        telemetry: null,
        diagnostics: null,
        feedback: null,
        pluginKillList: null,
        pluginMarketplace: null,
        changelog: null,
        nudge: null
      },
      services: {
        api: {
          baseUrl: 'https://api.hive.test'
        },
        identity: {
          issuer: 'https://identity.hive.test/realms/hive',
          clients: {
            desktop: 'hivecode-desktop',
            userWeb: 'hive-cloud-user-web',
            operatorWeb: 'hive-cloud-operator-web'
          }
        },
        oss: {
          enabled: false,
          endpoint: null,
          provider: null
        },
        update: {
          enabled: true,
          endpoint: 'https://updates.hive.test/hive/v1/updates/desktop/',
          checkEndpoint: 'https://updates.hive.test/hive/v1/updates/check',
          provider: 'hivecloud',
          channel: 'beta',
          checkIntervalHours: 24
        },
        relay: {
          enabled: false,
          directorUrl: null
        }
      }
    };
  `
}

function validBundledMainProductConfig(productConfig = validProductConfig()) {
  const declaration = productConfig.replace(
    'exports.hivecodeProductConfig =',
    'const hivecodeProductConfig ='
  )
  return `${declaration}
    Object.defineProperty(exports, "hivecodeProductConfig", {
      enumerable: true,
      get: function() { return hivecodeProductConfig; }
    });
  `
}

function validMinifiedRuntimeProductConfig(productConfig = validProductConfig()) {
  const declaration = productConfig.replace('exports.hivecodeProductConfig =', 'const e=')
  return `${declaration}Object.defineProperty(exports,\`l\`,{enumerable:!0,get:function(){return e}});`
}

function validPackagedMetadata() {
  return {
    name: 'hivecode',
    productName: 'HiveCode',
    description: 'HiveCode',
    author: { name: 'HiveCode' }
  }
}

async function createFixture({
  main,
  productConfig = validProductConfig(),
  runtimeProductConfig = validBundledMainProductConfig(),
  runtimeProductConfigChunkName = 'product-config-fixture.js',
  packageMetadata = validPackagedMetadata(),
  renderer = 'const productName = "HiveCode"',
  productLogo = null,
  electronUpdaterVersion = '6.8.9',
  mainChunks = {},
  publicEntries = {}
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'product-packaged-updater-'))
  roots.push(root)
  const resourcesDir = join(root, 'resources')
  await mkdir(resourcesDir, { recursive: true })
  await writeFile(join(resourcesDir, 'app.asar'), 'fixture', 'utf8')

  const updaterDir = join(resourcesDir, 'node_modules', 'electron-updater')
  const runtimeDir = join(resourcesDir, 'node_modules', 'builder-util-runtime')
  await mkdir(join(updaterDir, 'out'), { recursive: true })
  await mkdir(join(runtimeDir, 'out'), { recursive: true })
  await writeFile(
    join(updaterDir, 'package.json'),
    JSON.stringify({
      name: 'electron-updater',
      version: electronUpdaterVersion,
      main: 'out/main.js',
      dependencies: { 'builder-util-runtime': '9.7.0' }
    }),
    'utf8'
  )
  await writeFile(
    join(updaterDir, 'out', 'electronHttpExecutor.js'),
    `
      function getNetSession() {}
      class ElectronHttpExecutor {
        createRequest(options, callback) { this.cachedSession = getNetSession() }
        addRedirectHandlers(request, options, reject, redirectCount, handler) {
          request.on("redirect", () => {
            handler(builder_util_runtime_1.HttpExecutor.prepareRedirectUrlOptions("https://cdn.test", options))
          })
        }
      }
    `,
    'utf8'
  )
  await writeFile(
    join(runtimeDir, 'package.json'),
    JSON.stringify({ name: 'builder-util-runtime', version: '9.7.0', main: 'out/index.js' }),
    'utf8'
  )
  await writeFile(
    join(runtimeDir, 'out', 'httpExecutor.js'),
    `
      class HttpExecutor {
        doApiRequest(options) { this.addRedirectHandlers(request, options, reject, count, handler) }
        doDownload(options) { this.addRedirectHandlers(request, options, reject, count, handler) }
        static prepareRedirectUrlOptions(url, options) { return options }
      }
    `,
    'utf8'
  )

  const approvedProductLogo =
    productLogo ??
    (await readFile(join(import.meta.dirname, '..', '..', 'resources', 'product-logo.png')))
  const entries = new Map([
    ['package.json', JSON.stringify({ ...packageMetadata, main: './out/main/index.js' })],
    ['out/main/index.js', main ?? validMainBundle(runtimeProductConfigChunkName)],
    [`out/main/chunks/${runtimeProductConfigChunkName}`, runtimeProductConfig],
    ['out/shared/generated/product-config.js', productConfig],
    ['out/renderer/assets/index.js', renderer],
    ['out/renderer/assets/product-logo-test.png', approvedProductLogo]
  ])
  for (const [entry, source] of Object.entries(mainChunks)) {
    entries.set(entry, source)
  }
  for (const [entry, source] of Object.entries(publicEntries)) {
    entries.set(entry, source)
  }
  const asar = {
    listPackage: () => [...entries.keys()].map((entry) => `/${entry}`),
    extractFile: (_asarPath, internalPath) => {
      const value = entries.get(internalPath)
      return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
    }
  }
  return { resourcesDir, asar }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('packaged updater security boundary', () => {
  it('verifies the actual packaged main entry and updater dependency callback chain', async () => {
    const fixture = await createFixture()

    expect(verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toMatchObject(
      {
        passed: true,
        mainBundle: 'out/main/index.js',
        productConfigBundle: 'out/main/chunks/product-config-fixture.js',
        generatedProductConfigBundle: 'out/shared/generated/product-config.js',
        electronUpdaterVersion: '6.8.9',
        builderUtilRuntimeVersion: '9.7.0',
        rendererBrandMarker: 'HiveCode',
        approvedProductLogoEntry: 'out/renderer/assets/product-logo-test.png',
        appUpdateYmlExists: false
      }
    )
  })

  it('accepts the runtime product config in the current brand chunk', async () => {
    const fixture = await createFixture({
      runtimeProductConfigChunkName: 'brand-fixture.js'
    })

    expect(verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toMatchObject(
      {
        passed: true,
        productConfigBundle: 'out/main/chunks/brand-fixture.js'
      }
    )
  })

  it('accepts a statically exported runtime product config after identifier minification', async () => {
    const fixture = await createFixture({
      main: validMainBundle('brand-minified.js', 'l'),
      runtimeProductConfigChunkName: 'brand-minified.js',
      runtimeProductConfig: validMinifiedRuntimeProductConfig()
    })

    expect(verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toMatchObject(
      {
        passed: true,
        productConfigBundle: 'out/main/chunks/brand-minified.js'
      }
    )
  })

  it('rejects a canonical decoy export that the main bundle does not consume', async () => {
    const fixture = await createFixture({
      main: validMainBundle('brand-minified.js', 'a'),
      runtimeProductConfigChunkName: 'brand-minified.js',
      runtimeProductConfig: `${validMinifiedRuntimeProductConfig()}const t={name:\`brand\`};Object.defineProperty(exports,\`a\`,{enumerable:!0,get:function(){return t}});`
    })

    expect(() => verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toThrow(
      /does not consume its runtime product config export/i
    )
  })

  it('rejects multiple runtime product config chunk candidates', async () => {
    const fixture = await createFixture({
      mainChunks: {
        'out/main/chunks/brand-decoy.js': validBundledMainProductConfig()
      }
    })

    expect(() => verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toThrow(
      /exactly one runtime product config chunk \(found 2\)/i
    )
  })

  it('rejects upstream npm and PE identity in packaged application metadata', async () => {
    for (const packageMetadata of [
      { ...validPackagedMetadata(), name: 'orca' },
      { ...validPackagedMetadata(), productName: 'Orca' },
      { ...validPackagedMetadata(), description: 'Next-gen IDE for parallel agentic development' },
      { ...validPackagedMetadata(), author: { name: 'stablyai' } }
    ]) {
      const fixture = await createFixture({ packageMetadata })
      expect(() =>
        verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)
      ).toThrow(/packaged application metadata/i)
    }
  })

  it('accepts the TypeScript CommonJS export predeclaration before the static config', async () => {
    const fixture = await createFixture({
      productConfig: `exports.hivecodeProductConfig = void 0;\n${validProductConfig()}`
    })

    expect(verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toMatchObject(
      {
        passed: true,
        productConfigBundle: 'out/main/chunks/product-config-fixture.js',
        generatedProductConfigBundle: 'out/shared/generated/product-config.js'
      }
    )
  })

  it('rejects a forbidden upstream marketplace or star authority in the main runtime', async () => {
    for (const authority of [
      'https://github.com/stablyai/orca-plugins.git',
      'const repository = "stablyai/orca"',
      'https://github.com/stablyai/orca'
    ]) {
      const fixture = await createFixture({ main: `${validMainBundle()}\n${authority}` })
      expect(() =>
        verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)
      ).toThrow(/forbidden upstream authority/i)
    }
  })

  it('rejects every packaged product config field that re-enables an external authority', async () => {
    for (const field of [
      'publisher',
      'updateRepository',
      'starRepository',
      'artifacts',
      'relay',
      'telemetry',
      'diagnostics',
      'feedback',
      'pluginKillList',
      'pluginMarketplace',
      'changelog',
      'nudge',
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
    ]) {
      const fixture = await createFixture({
        productConfig: validProductConfig().replace(
          `${field}: null`,
          `${field}: "https://example.com"`
        )
      })

      expect(() =>
        verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)
      ).toThrow(new RegExp(`product config null policy is missing:.*${field}`))
    }
  })

  it('rejects a packaged updater authority that differs from the canonical HiveCloud feed', async () => {
    const fixture = await createFixture({
      productConfig: validProductConfig().replace(
        "update: 'https://updates.hive.test/hive/v1/updates/desktop/'",
        "update: 'https://updates.attacker.test/hive/v1/updates/desktop/'"
      )
    })

    expect(() => verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toThrow(
      /does not match the canonical product manifest/i
    )
  })

  it.each([
    ['cloud API', "cloud: 'https://api.hive.test'", "cloud: 'https://cloud.attacker.test'"],
    [
      'identity issuer',
      "identityIssuer: 'https://identity.hive.test/realms/hive'",
      "identityIssuer: 'https://identity.attacker.test/realms/hive'"
    ]
  ])(
    'rejects a packaged %s authority outside the canonical product manifest',
    async (_, from, to) => {
      const fixture = await createFixture({
        productConfig: validProductConfig().replace(from, to)
      })

      expect(() =>
        verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)
      ).toThrow(/does not match the canonical product manifest/i)
    }
  )

  it('validates the exported product config rather than accepting decoy null markers', async () => {
    const exportedConfig = validProductConfig().replace(
      "cloud: 'https://api.hive.test'",
      'cloud: "https://cloud.attacker.test"'
    )
    const decoyNullMarkers = validProductConfig().replace(
      'exports.hivecodeProductConfig =',
      'const decoy ='
    )
    const fixture = await createFixture({
      productConfig: `${exportedConfig}\n${decoyNullMarkers}`
    })

    expect(() => verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toThrow(
      /packaged product config/i
    )
  })

  it('rejects a malicious product config consumed by Main even when the standalone copy is safe', async () => {
    const runtimeProductConfig = validBundledMainProductConfig(
      validProductConfig().replace(
        "cloud: 'https://api.hive.test'",
        'cloud: "https://cloud.attacker.test"'
      )
    )
    const fixture = await createFixture({ runtimeProductConfig })

    expect(() => verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toThrow(
      /does not match the canonical product manifest/i
    )
  })

  it('rejects forbidden upstream authorities from every packaged main chunk', async () => {
    const fixture = await createFixture({
      mainChunks: {
        'out/main/chunks/unsafe.js': 'const attribution = "https://github.com/stablyai/orca";'
      }
    })

    expect(() => verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toThrow(
      /forbidden upstream authority/i
    )
  })

  it('rejects upstream public authorities from renderer, web, and shared runtimes', async () => {
    for (const entry of [
      'out/renderer/assets/unsafe.js',
      'out/web/assets/unsafe.js',
      'out/shared/unsafe.js'
    ]) {
      for (const authority of [
        'https://github.com/stablyai/orca/releases',
        'https://onorca.dev/docs',
        'https://discord.gg/fzjDKHxv8Q',
        'https://x.com/orca_build'
      ]) {
        const fixture = await createFixture({
          publicEntries: { [entry]: `const unsafeAuthority = "${authority}"` }
        })

        expect(() =>
          verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)
        ).toThrow(/forbidden upstream authority/i)
      }
    }
  })

  it('allows the isolated upstream skills source compatibility constant', async () => {
    const rendererCompatibilitySource =
      'const ORCA_SKILLS_REPOSITORY_URL = "https://github.com/stablyai/orca";'
    const fixture = await createFixture({
      renderer: `const productName = "HiveCode"; ${rendererCompatibilitySource}`,
      publicEntries: {
        'out/web/assets/compat.js':
          'const C="https://github.com/stablyai/orca",A="orca-cli",L="computer-use";',
        'out/shared/compat.js':
          "exports.ORCA_SKILLS_REPOSITORY_URL = 'https://github.com/stablyai/orca';"
      }
    })

    expect(() =>
      verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)
    ).not.toThrow()
  })

  it('rejects the legacy Orca logo fingerprint from the packaged renderer', async () => {
    const fixture = await createFixture({
      renderer: 'const productName = "HiveCode"; const legacyPath = "177.81311,248.33334"'
    })

    expect(() => verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toThrow(
      /legacy Orca logo fingerprint/i
    )
  })

  it('requires the approved HiveCode product logo bytes in the packaged renderer', async () => {
    const fixture = await createFixture({ productLogo: Buffer.from('not-the-approved-logo') })

    expect(() => verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toThrow(
      /approved HiveCode product logo/i
    )
  })

  it('rejects an unpinned or incompatible packaged updater dependency', async () => {
    const fixture = await createFixture({ electronUpdaterVersion: '6.9.0' })

    expect(() => verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toThrow(
      /electron-updater version/i
    )
  })

  it('rejects app-update.yml because product updates are disabled', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.resourcesDir, 'app-update.yml'), 'provider: github', 'utf8')

    expect(() => verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)).toThrow(
      /app-update\.yml/i
    )
  })
})
