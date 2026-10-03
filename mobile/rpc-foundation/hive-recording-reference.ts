import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { GoldenRecording } from '../src/test-support/rpc-recording/golden-recording'
import { assertRecordingSources } from './recording-source-fence'

export type HiveRecordingManifest = {
  version: 2
  baseline: string
  upstreamBaseline: string
  upstreamGoldensSha256: string
  recorderSha256: string
  scenariosSha256: string
  adapterSha256ByOperation: Record<string, string>
  overlays: Record<string, { sha256: string; reason: string }>
}

/** Pin repository text independently of the checkout's CRLF setting. */
export function recordingFileSha256(file: string): string {
  return createHash('sha256')
    .update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex')
}

export function upstreamGoldenSha256(directory: string): string {
  return createHash('sha256')
    .update(
      readdirSync(directory)
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) => `${name}:${recordingFileSha256(join(directory, name))}`)
        .join('\n')
    )
    .digest('hex')
}

const manifests = new Map<string, HiveRecordingManifest>()
const verifiedRecordings = new Map<string, string>()

function manifestFor(directory: string): HiveRecordingManifest | null {
  const cached = manifests.get(directory)
  if (cached) {
    return cached
  }
  const path = join(directory, '../hive/manifest.json')
  if (!existsSync(path)) {
    return null
  }
  const manifest: HiveRecordingManifest = JSON.parse(readFileSync(path, 'utf8'))
  if (
    manifest.version !== 2 ||
    !/^[a-f0-9]{40}$/.test(manifest.baseline) ||
    !/^[a-f0-9]{40}$/.test(manifest.upstreamBaseline) ||
    !/^[a-f0-9]{64}$/.test(manifest.recorderSha256) ||
    !/^[a-f0-9]{64}$/.test(manifest.scenariosSha256) ||
    upstreamGoldenSha256(directory) !== manifest.upstreamGoldensSha256
  ) {
    throw new Error('Hive recording provenance does not match its frozen upstream reference')
  }
  manifests.set(directory, manifest)
  return manifest
}

export function hiveRecordingBaseline(root: string, upstreamBaseline: string): string {
  if (process.env.RPC_FOUNDATION_MODE === '--record') {
    if (process.env.RPC_FOUNDATION_RECORD !== '1') {
      throw new Error('Recording requires RPC_FOUNDATION_RECORD=1')
    }
    // Recording creates evidence for a new source commit, before its overlay can be reviewed.
    // Callers using this helper fence the source; the recorder script also fences both ends.
    if (verifiedRecordings.get(root) !== upstreamBaseline) {
      assertRecordingSources(root, upstreamBaseline, true)
      verifiedRecordings.set(root, upstreamBaseline)
    }
    return upstreamBaseline
  }
  const manifest = manifestFor(join(root, 'mobile/rpc-foundation/goldens'))
  return manifest?.upstreamBaseline === upstreamBaseline ? manifest.baseline : upstreamBaseline
}

/** Materialize a product reference without changing any upstream golden bytes or provenance. */
export function hiveGoldenReference(
  directory: string,
  id: string,
  upstream: GoldenRecording,
  readRaw: (directory: string, id: string) => GoldenRecording
): GoldenRecording {
  const manifest = manifestFor(directory)
  if (!manifest) {
    return upstream
  }
  const adapterSha256 = manifest.adapterSha256ByOperation[upstream.operation]
  if (!/^[a-f0-9]{64}$/.test(adapterSha256 ?? '')) {
    throw new Error(`Missing product adapter provenance for ${upstream.operation}`)
  }
  const overlay = manifest.overlays[id]
  if (overlay) {
    const path = join(directory, '../hive/goldens', `${id}.json`)
    if (recordingFileSha256(path) !== overlay.sha256) {
      throw new Error(`Hive recording overlay changed without review: ${id}`)
    }
    const golden = readRaw(join(directory, '../hive/goldens'), id)
    if (
      golden.operation !== upstream.operation ||
      golden.family !== upstream.family ||
      JSON.stringify(golden.namedDeltas) !== JSON.stringify(upstream.namedDeltas)
    ) {
      throw new Error(`Hive recording overlay changed its scenario contract: ${id}`)
    }
    return golden
  }
  return upstream
}

/** The immutable reference file used after provenance and sparse-overlay validation. */
export function hiveGoldenFilePath(directory: string, id: string): string {
  const manifest = manifestFor(directory)
  return join(manifest?.overlays[id] ? join(directory, '../hive/goldens') : directory, `${id}.json`)
}
