import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

// Resource-pruning and launcher-permission fixtures contain only their own required artifacts.
// Scope package-wide native Pi and updater artifact checks to this fresh config instance.
export function createAfterPackFixture() {
  const nativePi = require('../native-pi-resources.cjs')
  const updater = require('../packaged-updater-security-boundary.cjs')
  const configPath = require.resolve('../electron-builder.config.cjs')
  const previousConfig = require.cache[configPath]
  const verifyNativePi = nativePi.verifyPackagedNativePi
  const verifyUpdater = updater.verifyPackagedUpdaterSecurityBoundary
  try {
    nativePi.verifyPackagedNativePi = () => undefined
    updater.verifyPackagedUpdaterSecurityBoundary = () => undefined
    delete require.cache[configPath]
    return require(configPath)
  } finally {
    nativePi.verifyPackagedNativePi = verifyNativePi
    updater.verifyPackagedUpdaterSecurityBoundary = verifyUpdater
    if (previousConfig) {
      require.cache[configPath] = previousConfig
    } else {
      delete require.cache[configPath]
    }
  }
}

// Non-ELF stand-ins retain the real existence and executable-bit checks.
export async function seedBundledRipgrep(resourcesDir) {
  const { BUNDLED_RIPGREP_PLATFORMS } = require('../bundled-ripgrep-resources.cjs')
  for (const platform of BUNDLED_RIPGREP_PLATFORMS) {
    const dir = join(resourcesDir, 'ripgrep', platform)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, platform.startsWith('win32-') ? 'rg.exe' : 'rg'), '', 'utf8')
  }
}
