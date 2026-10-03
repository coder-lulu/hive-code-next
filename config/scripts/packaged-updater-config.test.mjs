import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, it, expect } from 'vitest'

const require = createRequire(import.meta.url)
const { NsisUpdater } = require('electron-updater/out/NsisUpdater')
const { writePackagedUpdaterConfig } = require('../packaged-updater-config.cjs')
const product = require('../product/hivecode.product.json')

describe('packaged updater download configuration', () => {
  it('lets the real updater initialize its download cache with automatic publishing disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hive-updater-config-'))
    try {
      const app = {
        version: '1.5.0-beta.5',
        name: 'HiveCode',
        isPackaged: true,
        baseCachePath: root,
        appUpdateConfigPath: join(root, 'app-update.yml')
      }
      const missing = new NsisUpdater(undefined, app)
      missing.setFeedURL({ provider: 'generic', url: product.endpoints.update })
      await expect(missing.getOrCreateDownloadHelper()).rejects.toMatchObject({ code: 'ENOENT' })
      writePackagedUpdaterConfig(root)
      const updater = new NsisUpdater(undefined, app)
      updater.setFeedURL({ provider: 'generic', url: product.endpoints.update })
      const helper = await updater.getOrCreateDownloadHelper()
      expect(helper.cacheDir).toBe(join(root, 'hivecode-updater'))
      expect(JSON.parse(readFileSync(app.appUpdateConfigPath, 'utf8'))).toEqual({
        provider: 'generic',
        url: product.endpoints.update,
        updaterCacheDirName: 'hivecode-updater'
      })
      expect(require('../electron-builder.config.cjs').publish).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
