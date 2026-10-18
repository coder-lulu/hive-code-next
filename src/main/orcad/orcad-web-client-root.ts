import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Optional in SSH slots; installed archives carry the same Web projection as desktop. */
export function resolveOrcadWebClientRoot(installRoot: string): string | undefined {
  const root = join(installRoot, 'out', 'web')
  return existsSync(join(root, 'web-index.html')) ? root : undefined
}
