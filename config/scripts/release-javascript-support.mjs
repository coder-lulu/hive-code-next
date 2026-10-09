import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDirectInvocation } from './script-entry-detection.mjs'

export function releaseJavascriptSupport(root = process.cwd()) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (!pkg.scripts?.['build:release:javascript'] || !pkg.scripts?.['build:release:host']) {
    return { supported: false, reason: 'This source has no shared JavaScript build commands.' }
  }
  const buildConfig = join(root, 'electron.vite.config.ts')
  const packPlugin = join(root, 'config/build-plugins/managed-pi-pack-build.ts')
  if (
    existsSync(buildConfig) &&
    existsSync(packPlugin) &&
    /\bcreateManagedPiPackBuildPlugin\s*\(/.test(readFileSync(buildConfig, 'utf8')) &&
    /\bHIVECODE_MANAGED_PI_PACK_TRUST\s*:/.test(readFileSync(packPlugin, 'utf8'))
  ) {
    return {
      supported: false,
      reason:
        'Managed Pi compiles platform/architecture-specific Pack hashes into application trust. Full per-platform builds are required.'
    }
  }
  return { supported: true, reason: '' }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  const support = releaseJavascriptSupport()
  console.log(`supported=${support.supported}`)
  console.log(`reason=${support.reason}`)
}
