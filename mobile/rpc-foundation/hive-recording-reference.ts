import { hiveRecordingInputs } from './hive-recording-inputs'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { GoldenRecording } from '../src/test-support/rpc-recording/golden-recording'
import {
  decodeRecordingManifest,
  sha256,
  type RecordingManifest
} from '../../config/scripts/upstream-recording-source.mjs'

export type HiveRecordingManifest = RecordingManifest

const textHashes = new Map<string, { stamp: string; digest: string }>()
const validatedInputs = new Map<string, string>()

/** Pin repository text independently of the checkout's CRLF setting. */
export function recordingFileSha256(file: string): string {
  const stat = statSync(file, { bigint: true })
  const stamp = `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
  const cached = textHashes.get(file)
  if (cached?.stamp === stamp) {
    return cached.digest
  }
  const digest = createHash('sha256')
    .update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex')
  textHashes.set(file, { stamp, digest })
  return digest
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

export function manifestFor(directory: string): HiveRecordingManifest | null {
  const path = join(directory, '../hive/manifest.json')
  if (!existsSync(path)) {
    return null
  }
  const manifest = decodeRecordingManifest(JSON.parse(readFileSync(path, 'utf8')))
  if (upstreamGoldenSha256(directory) !== manifest.upstreamGoldensSha256) {
    throw new Error('Hive recording provenance does not match its frozen upstream reference')
  }
  if (
    manifest.version === 3 &&
    sha256(readFileSync(join(directory, '../hive/reviewed-deltas.json'))) !==
      manifest.reviewedDeltasSha256
  ) {
    throw new Error('Hive reviewed deltas changed without review')
  }
  const validationKey = JSON.stringify(manifest)
  if (manifest.version === 3 && validatedInputs.get(directory) !== validationKey) {
    const inputs = hiveRecordingInputs(resolve(directory, '../../..'))
    const actual = {
      recorderSha256: manifest.recorderSha256,
      scenariosSha256: manifest.scenariosSha256,
      adapterSha256ByOperation: manifest.adapterSha256ByOperation
    }
    if (JSON.stringify(actual) !== JSON.stringify(inputs.digests)) {
      throw new Error(
        'Hive recording input digests differ from current recorder, scenarios or adapters'
      )
    }
    const supported = readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .filter((file) =>
        Object.hasOwn(
          manifest.adapterSha256ByOperation,
          JSON.parse(readFileSync(join(directory, file), 'utf8')).operation
        )
      )
      .map((file) => file.slice(0, -5))
      .sort()
    if (JSON.stringify(supported) !== JSON.stringify(inputs.supportedIds)) {
      throw new Error('Hive recording supported domain differs from current scenario derivation')
    }
    validatedInputs.set(directory, validationKey)
  }
  return manifest
}

/** Materialize a product reference without changing any upstream golden bytes or provenance. */
export function hiveGoldenReference(
  directory: string,
  id: string,
  upstream: GoldenRecording,
  readRaw: (directory: string, id: string) => GoldenRecording
): GoldenRecording {
  const manifest = manifestFor(directory)
  return materializeGolden(directory, id, upstream, readRaw, manifest)
}

function materializeGolden(
  directory: string,
  id: string,
  upstream: GoldenRecording,
  readRaw: (directory: string, id: string) => GoldenRecording,
  manifest: HiveRecordingManifest | null
): GoldenRecording {
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
    if (
      (manifest.version === 3 ? sha256(readFileSync(path)) : recordingFileSha256(path)) !==
      overlay.sha256
    ) {
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

/** Bound full-corpus validation to this synchronous batch; never retain a trusted manifest. */
export function hiveGoldenReferences(
  directory: string,
  ids: readonly string[],
  readRaw: (directory: string, id: string) => GoldenRecording
): GoldenRecording[] {
  const manifest = manifestFor(directory)
  const identity = JSON.stringify(manifest)
  const goldens = ids.map((id) =>
    materializeGolden(directory, id, readRaw(directory, id), readRaw, manifest)
  )
  if (JSON.stringify(manifestFor(directory)) !== identity) {
    throw new Error('Hive recording provenance changed during the batch')
  }
  return goldens
}
