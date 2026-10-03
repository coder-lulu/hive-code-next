import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { textPackManifestFixture } from '../native-chat/hive-agent-text-pack.test-fixture'
import { managedPiPackArtifactNames, type ManagedPiPackIndex } from './managed-pi-pack-index'

export const packDigest = (content: string | Buffer) =>
  createHash('sha256').update(content).digest('hex')

/** Synthetic artifacts exercise integrity only; they are never executable production fallbacks. */
export async function installedPackFixture(rootDirectory: string) {
  await mkdir(rootDirectory, { recursive: true })
  const { packRevision: _revision, ...manifest } = textPackManifestFixture()
  const names = managedPiPackArtifactNames(manifest.platform)
  const artifacts = {} as ManagedPiPackIndex['artifacts']
  for (const role of Object.keys(names) as (keyof typeof names)[]) {
    const content = Buffer.from(`synthetic-${role}-artifact`)
    await writeFile(join(rootDirectory, names[role]), content)
    artifacts[role] = { sha256: packDigest(content), size: content.length }
  }
  const index: ManagedPiPackIndex = { schemaVersion: 1, manifest, artifacts }
  const trust = { rootDirectory, indexSha256: '' }
  const saveIndex = async () => {
    const content = JSON.stringify(index)
    await writeFile(join(rootDirectory, 'pack-index.json'), content)
    trust.indexSha256 = packDigest(content)
  }
  await saveIndex()
  return { trust, index, names, saveIndex }
}

export function bundledNodeProbeFixture() {
  const manifest = textPackManifestFixture()
  return {
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      node: manifest.nodeVersion,
      platform: manifest.platform,
      architecture: manifest.architecture
    }),
    stderr: '',
    timedOut: false
  }
}
