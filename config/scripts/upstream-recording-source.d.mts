export type RecordingSource = {
  kind: 'tree-sync-content'
  controlSha: string
  upstreamSha: string
  guardVersion: 1
  guardedSourcesSha256: string
  guardedFileCount: number
}
export type RecordingProjection = {
  guardVersion: 1
  guardedSourcesSha256: string
  guardedFileCount: number
  entries: { path: string; mode: string; blob: string }[]
}
type ManifestFields = {
  upstreamGoldensSha256: string
  recorderSha256: string
  scenariosSha256: string
  adapterSha256ByOperation: Record<string, string>
  overlays: Record<string, { sha256: string; reason: string }>
}
export type RecordingManifestV3 = ManifestFields & {
  version: 3
  source: RecordingSource
  reviewedDeltasSha256: string
}
export type RecordingManifest =
  | RecordingManifestV3
  | (ManifestFields & {
      version: 2
      baseline: string
      upstreamBaseline: string
    })
export const CONTROL_PATHS: readonly string[]
export function sha256(bytes: string | Uint8Array): string
export function guardedPath(path: string): boolean
export function recordingProjection(cwd: string, tree: string): RecordingProjection
export function exportRecordingSources(
  cwd: string,
  projection: RecordingProjection,
  output: string
): void
export function assertRecordingFixture(root: string, projection: RecordingProjection): void
export function assertRecordingOutput(root: string, output: string, leaves?: string[]): void
export function decodeRecordingSource(value: unknown): RecordingSource
export function decodeRecordingManifest(value: unknown): RecordingManifest
export function verifyRecordingSource(options: {
  cwd?: string
  target: string
  upstream: string
  head: string
  targetBranch?: string
}): {
  schemaVersion: 1
  check: 'recording-source'
  passed: true
  targetSha: string
  upstreamSha: string
  candidateSha: string
  controlSha: string
  contentCommitSha: string
  controlSourcesSha256: string
  controlFileCount: number
  guardedSourcesSha256: string
  guardedFileCount: number
}

export type RecordingControlProjection = {
  controlSourcesSha256: string
  controlFileCount: number
  entries: { path: string; mode: string; blob: string }[]
}
export function recordingControlProjection(
  cwd: string,
  controlSha: string
): RecordingControlProjection
export function exportRecordingControls(
  cwd: string,
  controlSha: string,
  projection: RecordingControlProjection,
  output: string
): void
export function assertRecordingControls(
  root: string,
  controlSha: string,
  projection: RecordingControlProjection,
  objectRepository?: string
): void
