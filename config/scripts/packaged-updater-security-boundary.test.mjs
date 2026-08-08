import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  verifyPackagedUpdaterSecurityBoundary
} = require('../packaged-updater-security-boundary.cjs')

const roots = []

function validMainBundle() {
  return `
    installProductUpdaterHttpExecutorBoundary(executor)
    executor.addRedirectHandlers = function boundedRedirectHandlers() {}
    executor.doApiRequest = function boundedApiRequest() {}
    executor.doDownload = function boundedDownload() {}
    electron.session.fromPartition("electron-updater", { cache: false })
    autoUpdater.autoInstallOnAppQuit = false
    const MAX_UPDATER_ARTIFACT_BYTES = 2147483648
    const config = {
      updateRepository: null,
      updateChannel: null,
      starRepository: null,
      update: null,
      telemetry: null,
      diagnostics: null,
      pluginMarketplace: null
    }
    sanitizeCrossOriginHeaders(headers)
    throw new Error("Too many updater redirects")
    throw new Error("electron-updater HTTP executor is unavailable")
  `
}

function validProductConfig() {
  return `
    updateRepository: null,
    updateChannel: null,
    starRepository: null,
    cloud: null,
    relay: null,
    update: null,
    telemetry: null,
    diagnostics: null,
    feedback: null,
    pluginKillList: null,
    pluginMarketplace: null,
    changelog: null,
    nudge: null
  `
}

async function createFixture({
  main = validMainBundle(),
  productConfig = validProductConfig(),
  electronUpdaterVersion = '6.8.9'
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

  const entries = new Map([
    ['package.json', JSON.stringify({ main: './out/main/index.js' })],
    ['out/main/index.js', main],
    ['out/shared/generated/product-config.js', productConfig]
  ])
  const asar = {
    listPackage: () => [...entries.keys()].map((entry) => `/${entry}`),
    extractFile: (_asarPath, internalPath) => Buffer.from(entries.get(internalPath), 'utf8')
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
        productConfigBundle: 'out/shared/generated/product-config.js',
        electronUpdaterVersion: '6.8.9',
        builderUtilRuntimeVersion: '9.7.0',
        appUpdateYmlExists: false
      }
    )
  })

  it('rejects a forbidden upstream marketplace or star authority in the main runtime', async () => {
    for (const authority of [
      'https://github.com/stablyai/orca-plugins.git',
      'const repository = "stablyai/orca"'
    ]) {
      const fixture = await createFixture({ main: `${validMainBundle()}\n${authority}` })
      expect(() =>
        verifyPackagedUpdaterSecurityBoundary(fixture.resourcesDir, fixture.asar)
      ).toThrow(/forbidden upstream authority/i)
    }
  })

  it('rejects every packaged product config field that re-enables an external authority', async () => {
    for (const field of [
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
