import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  upstreamGoldenSha256,
  type HiveRecordingManifest
} from '../../rpc-foundation/hive-recording-reference'

export type HiveGoldenDomain = {
  kind: 'hive-overlay' | 'standalone'
  /** Every immutable upstream recording, or every file in a standalone recording directory. */
  upstreamIds: readonly string[]
  /** References whose operation has product adapter provenance, or every standalone recording. */
  supportedIds: readonly string[]
  unsupportedIds: readonly string[]
}

/**
 * Read the canonical upstream/product domains or a self-contained scratch recording directory.
 *
 * The repository corpus has a sibling Hive manifest that pins every upstream file and names the
 * supported operation subset. Recorder scratch directories intentionally have no manifest until
 * publication; like `readGolden`, they treat every file they contain as a standalone reference.
 */
export function readHiveGoldenDomain(directory: string): HiveGoldenDomain {
  const upstreamIds = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort()
  const manifestPath = join(directory, '../hive/manifest.json')
  if (!existsSync(manifestPath)) {
    return {
      kind: 'standalone',
      upstreamIds,
      supportedIds: upstreamIds,
      unsupportedIds: []
    }
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- The fields used below are validated before use.
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as HiveRecordingManifest
  const adapters = manifest.adapterSha256ByOperation
  if (
    manifest.version !== 2 ||
    typeof adapters !== 'object' ||
    adapters === null ||
    Array.isArray(adapters) ||
    Object.values(adapters).some((digest) => !/^[a-f0-9]{64}$/.test(digest)) ||
    upstreamGoldenSha256(directory) !== manifest.upstreamGoldensSha256
  ) {
    throw new Error('Hive golden domain does not match its frozen upstream reference')
  }

  const supportedIds: string[] = []
  const unsupportedIds: string[] = []
  for (const id of upstreamIds) {
    // This reader deliberately needs only the immutable header. The full reader is exercised by
    // the callers that materialize Hive overlays.
    const header = JSON.parse(readFileSync(join(directory, `${id}.json`), 'utf8')) as {
      operation?: unknown
    }
    if (typeof header.operation !== 'string') {
      throw new Error(`Upstream golden ${id} has no operation`)
    }
    const target = Object.hasOwn(adapters, header.operation) ? supportedIds : unsupportedIds
    target.push(id)
  }
  return { kind: 'hive-overlay', upstreamIds, supportedIds, unsupportedIds }
}
