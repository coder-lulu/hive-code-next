import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { readGoldenRaw } from '../src/test-support/rpc-recording/golden-recording'
import type { GoldenRecording } from '../src/test-support/rpc-recording/golden-recording'
import {
  recordingFileSha256,
  upstreamGoldenSha256,
  type HiveRecordingManifest
} from './hive-recording-reference'
import { assertRecordingSources } from './recording-source-fence'

export function recordingTraceSha256(golden: GoldenRecording): string {
  return createHash('sha256').update(JSON.stringify(golden.recording)).digest('hex')
}

type ReviewedDeltas = {
  upstreamGoldensSha256: string
  deltas: Record<string, { upstreamTraceSha256: string; hiveTraceSha256: string; reason: string }>
}

/** Publish reviewed trace differences for the product-supported upstream scenario subset. */
export function writeHiveRecordingOverlay(root: string, baseline: string, recorded: string): void {
  assertRecordingSources(root, baseline, true)
  const provenance: Omit<HiveRecordingManifest, 'version' | 'upstreamGoldensSha256' | 'overlays'> =
    JSON.parse(readFileSync(join(recorded, '../provenance.json'), 'utf8'))
  if (
    provenance.baseline !== baseline ||
    !/^[a-f0-9]{40}$/.test(provenance.upstreamBaseline) ||
    !/^[a-f0-9]{64}$/.test(provenance.recorderSha256) ||
    !/^[a-f0-9]{64}$/.test(provenance.scenariosSha256) ||
    !Object.keys(provenance.adapterSha256ByOperation).length ||
    Object.values(provenance.adapterSha256ByOperation).some(
      (digest) => !/^[a-f0-9]{64}$/.test(digest)
    )
  ) {
    throw new Error('Hive recording has inconsistent source provenance')
  }
  const foundation = join(root, 'mobile/rpc-foundation')
  const upstream = join(foundation, 'goldens')
  const target = join(foundation, 'hive')
  const reviewed: ReviewedDeltas = JSON.parse(
    readFileSync(join(target, 'reviewed-deltas.json'), 'utf8')
  )
  const upstreamDigest = upstreamGoldenSha256(upstream)
  if (upstreamDigest !== reviewed.upstreamGoldensSha256) {
    throw new Error('Upstream golden references changed since Hive delta review')
  }
  const files = readdirSync(upstream)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const recordedFiles = readdirSync(recorded)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const upstreamFiles = new Set(files)
  if (!recordedFiles.length || recordedFiles.some((file) => !upstreamFiles.has(file))) {
    throw new Error(
      'Hive recording contains no supported upstream scenarios or an unknown scenario'
    )
  }
  const manifest: HiveRecordingManifest = {
    version: 2,
    ...provenance,
    adapterSha256ByOperation: {},
    upstreamGoldensSha256: upstreamDigest,
    overlays: {}
  }
  for (const file of recordedFiles) {
    const id = file.slice(0, -5)
    const old = readGoldenRaw(upstream, id)
    const next = readGoldenRaw(recorded, id)
    const stable = ['operation', 'family', 'namedDeltas', 'goldenFormatVersion'] as const
    if (stable.some((key) => JSON.stringify(old[key]) !== JSON.stringify(next[key]))) {
      throw new Error(`Hive recording changed the scenario contract: ${id}`)
    }
    const adapter = provenance.adapterSha256ByOperation[next.operation]
    if (!adapter || !/^[a-f0-9]{64}$/.test(adapter)) {
      throw new Error(`Missing product adapter provenance for ${next.operation}`)
    }
    manifest.adapterSha256ByOperation[next.operation] = adapter
    const before = recordingTraceSha256(old)
    const after = recordingTraceSha256(next)
    if (before === after) {
      continue
    }
    const delta = reviewed.deltas[id]
    if (
      !delta ||
      delta.upstreamTraceSha256 !== before ||
      delta.hiveTraceSha256 !== after ||
      !delta.reason
    ) {
      throw new Error(`Unreviewed Hive recording difference: ${id}`)
    }
    manifest.overlays[id] = {
      sha256: recordingFileSha256(join(recorded, file)),
      reason: delta.reason
    }
  }
  if (
    JSON.stringify(Object.keys(manifest.overlays).sort()) !==
    JSON.stringify(Object.keys(reviewed.deltas).sort())
  ) {
    throw new Error('A reviewed Hive delta disappeared or was not recorded')
  }
  const overlayDirectory = join(target, 'goldens')
  mkdirSync(overlayDirectory, { recursive: true })
  for (const file of readdirSync(overlayDirectory).filter((name) => name.endsWith('.json'))) {
    if (!Object.hasOwn(manifest.overlays, file.slice(0, -5))) {
      unlinkSync(join(overlayDirectory, file))
    }
  }
  for (const id of Object.keys(manifest.overlays)) {
    copyFileSync(join(recorded, `${id}.json`), join(overlayDirectory, `${id}.json`))
  }
  writeFileSync(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}
