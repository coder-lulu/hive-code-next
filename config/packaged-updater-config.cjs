const { writeFileSync, readFileSync } = require('node:fs')
const { isDeepStrictEqual } = require('node:util')
const { join } = require('node:path')
const product = require('./product/hivecode.product.json')

function expectedConfig() {
  return {
    provider: 'generic',
    url: product.endpoints.update,
    updaterCacheDirName: `${product.slug}-updater`
  }
}

function writePackagedUpdaterConfig(resourcesDir) {
  // setFeedURL does not replace electron-updater's on-disk download cache configuration.
  writeFileSync(
    join(resourcesDir, 'app-update.yml'),
    `${JSON.stringify(expectedConfig(), null, 2)}\n`
  )
}

function verifyPackagedUpdaterConfig(resourcesDir) {
  try {
    const actual = JSON.parse(readFileSync(join(resourcesDir, 'app-update.yml'), 'utf8'))
    if (isDeepStrictEqual(actual, expectedConfig())) {
      return
    }
  } catch {
    // Missing or malformed packaging metadata is equally unusable for downloads.
  }
  throw new Error(
    'Packaged app-update.yml must match the HiveCode update endpoint and cache directory'
  )
}

module.exports = { writePackagedUpdaterConfig, verifyPackagedUpdaterConfig }
