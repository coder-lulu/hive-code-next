import { isAbsolute, join } from 'node:path'
import { loadManagedPiTextPack } from './managed-pi-pack-loader'

declare const HIVECODE_MANAGED_PI_PACK_TRUST: Readonly<Record<string, string>>

/** Trust is compiled from the build producer, never read from installed files or environment. */
export function getProductManagedPiPackIdentity(
  platform: string = process.platform,
  architecture: string = process.arch
) {
  if (
    !['win32', 'darwin', 'linux'].includes(platform) ||
    !['x64', 'arm64'].includes(architecture)
  ) {
    throw new Error('hive_agent_pack_unavailable')
  }
  const directoryKey = `${platform}-${architecture}`
  let indexSha256: string | undefined
  try {
    indexSha256 = HIVECODE_MANAGED_PI_PACK_TRUST[directoryKey]
  } catch {
    throw new Error('hive_agent_pack_unavailable')
  }
  if (typeof indexSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(indexSha256)) {
    throw new Error('hive_agent_pack_unavailable')
  }
  return Object.freeze({ directoryKey, indexSha256 })
}

export async function loadProductManagedPiTextPack(resourcesDirectory: string) {
  if (!isAbsolute(resourcesDirectory)) {
    throw new Error('hive_agent_pack_unavailable')
  }
  const identity = getProductManagedPiPackIdentity()
  return loadManagedPiTextPack({
    rootDirectory: join(resourcesDirectory, 'managed-pi', identity.directoryKey),
    indexSha256: identity.indexSha256
  })
}
