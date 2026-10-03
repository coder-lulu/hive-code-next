import type { HiveCloudUpdateArtifact } from './hivecloud-update-check'

type HiveCloudManifestFile = {
  url?: unknown
  sha512?: unknown
  size?: unknown
}

type HiveCloudManifest = {
  version?: unknown
  files?: unknown
  path?: unknown
  sha512?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canonicalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }
  try {
    const url = new URL(value)
    return url.href
  } catch {
    return null
  }
}

function sameUrl(left: unknown, right: string): boolean {
  return canonicalUrl(left) === canonicalUrl(right)
}

/**
 * Binds the generic electron-updater manifest to the control-plane artifact.
 *
 * The feed is served by HiveCloud, while the package bytes live behind an
 * immutable UUID gateway. Checking only `version` would allow a malformed or
 * compromised manifest to select a different signed package. The control
 * plane's URL, digest and size therefore remain the source of truth.
 */
export function validateHiveCloudUpdateManifest(
  value: unknown,
  expected: {
    versionName: string
    artifact: HiveCloudUpdateArtifact
  }
): void {
  if (!isRecord(value)) {
    throw new Error('HiveCloud update metadata is not an object')
  }
  const manifest = value as HiveCloudManifest
  if (manifest.version !== expected.versionName) {
    throw new Error('HiveCloud update metadata version does not match the control plane')
  }

  const artifact = expected.artifact
  if (
    !artifact.downloadUrl ||
    !artifact.sha512 ||
    artifact.size === null ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size <= 0
  ) {
    throw new Error('HiveCloud control-plane artifact is incomplete')
  }

  if (!Array.isArray(manifest.files) || manifest.files.length !== 1) {
    throw new Error('HiveCloud update metadata must contain exactly one package')
  }
  const file = manifest.files[0]
  if (!isRecord(file)) {
    throw new Error('HiveCloud update metadata contains an invalid package')
  }
  const manifestFile = file as HiveCloudManifestFile
  if (
    !sameUrl(manifestFile.url, artifact.downloadUrl) ||
    typeof manifestFile.sha512 !== 'string' ||
    manifestFile.sha512.toLowerCase() !== artifact.sha512.toLowerCase() ||
    manifestFile.size !== artifact.size
  ) {
    throw new Error('HiveCloud update metadata does not match the control-plane artifact')
  }

  // Keep the legacy top-level fields bound as well. HiveCloud emits both forms
  // for electron-updater compatibility; accepting a disagreement would make
  // provider-version differences observable as an integrity bypass.
  if (
    !sameUrl(manifest.path, artifact.downloadUrl) ||
    typeof manifest.sha512 !== 'string' ||
    manifest.sha512.toLowerCase() !== artifact.sha512.toLowerCase()
  ) {
    throw new Error('HiveCloud update metadata legacy fields do not match the control plane')
  }
}
