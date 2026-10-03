import { join } from 'node:path'
import type { Plugin } from 'vite'
import { produceManagedPiTextPack } from './managed-pi-pack-producer'

export function createManagedPiPackBuildPlugin(projectRoot: string): Plugin {
  return {
    name: 'hive-managed-pi-pack-build',
    async config() {
      const pack = await produceManagedPiTextPack(
        projectRoot,
        join(projectRoot, 'out', 'managed-pi')
      )
      return {
        define: {
          HIVECODE_MANAGED_PI_PACK_TRUST: JSON.stringify({ [pack.directoryKey]: pack.indexSha256 })
        }
      }
    }
  }
}
