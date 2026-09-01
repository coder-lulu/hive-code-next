import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveProductUpdateSource } from '../../shared/product-update-source'

export type DesktopReleaseIdentity = {
  product: 'hivecode'
  platform: 'windows' | 'macos' | 'linux'
  architecture: string
  channel: string
  versionName: string
  buildNumber: number
  commitSha: string | null
}

function platformName(): DesktopReleaseIdentity['platform'] {
  if (process.platform === 'win32') {
    return 'windows'
  }
  if (process.platform === 'darwin') {
    return 'macos'
  }
  return 'linux'
}

function readPackagedBuildNumber(): number {
  try {
    const packageJson = JSON.parse(
      readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')
    ) as {
      hivecodeBuildNumber?: unknown
      hivecodeReleaseIdentity?: { buildNumber?: unknown }
    }
    const packagedValue =
      packageJson.hivecodeBuildNumber ?? packageJson.hivecodeReleaseIdentity?.buildNumber
    if (
      typeof packagedValue === 'number' &&
      Number.isSafeInteger(packagedValue) &&
      packagedValue > 0
    ) {
      // A packaged identity is immutable release metadata. Never let a shell
      // environment variable override it: doing so would let a user spoof a
      // higher build and bypass a mandatory-update floor.
      return packagedValue
    }
  } catch {
    // Fall through to the development-only environment fallback below.
  }
  if (!app.isPackaged) {
    const envValue = Number.parseInt(process.env.HIVECODE_BUILD_NUMBER ?? '', 10)
    if (Number.isSafeInteger(envValue) && envValue > 0) {
      return envValue
    }
  }
  return 1
}

function readPackagedIdentity(): Partial<DesktopReleaseIdentity> {
  try {
    const packageJson = JSON.parse(
      readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')
    ) as { hivecodeReleaseIdentity?: Partial<DesktopReleaseIdentity> }
    return packageJson.hivecodeReleaseIdentity ?? {}
  } catch {
    return {}
  }
}

export function getDesktopReleaseIdentity(): DesktopReleaseIdentity {
  const source = resolveProductUpdateSource()
  const packagedIdentity = readPackagedIdentity()
  return {
    product: 'hivecode',
    platform: platformName(),
    architecture: packagedIdentity.architecture ?? process.arch,
    // Packaged identity is authoritative for internal/beta/stable build
    // selection; the product manifest is the fallback for legacy clients.
    channel: packagedIdentity.channel ?? source?.channel ?? 'beta',
    versionName: app.getVersion() || packagedIdentity.versionName || '0.0.0',
    buildNumber: readPackagedBuildNumber() || packagedIdentity.buildNumber || 1,
    commitSha: process.env.HIVECODE_COMMIT_SHA ?? packagedIdentity.commitSha ?? null
  }
}
