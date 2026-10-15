import { readFileSync } from 'node:fs'
import {
  assertRecordingFixture,
  assertRecordingControls,
  type RecordingControlProjection,
  decodeRecordingSource,
  type RecordingProjection,
  type RecordingSource
} from '../../config/scripts/upstream-recording-source.mjs'

/** Raw exported fixture checks at both ends; Git checkout filters are not evidence. */
export function assertRecordingSources(
  root: string,
  source: RecordingSource,
  projection: RecordingProjection,
  controlProjection: RecordingControlProjection
): void {
  decodeRecordingSource(source)
  if (
    source.guardedSourcesSha256 !== projection.guardedSourcesSha256 ||
    source.guardedFileCount !== projection.guardedFileCount ||
    source.guardVersion !== projection.guardVersion
  ) {
    throw new Error('Recording source does not match its independently frozen projection')
  }
  assertRecordingControls(root, source.controlSha, controlProjection)
  assertRecordingFixture(root, projection)
}

export function readRecordingSourceInput(file: string): {
  source: RecordingSource
  projection: RecordingProjection
  controlProjection: RecordingControlProjection
} {
  const input = JSON.parse(readFileSync(file, 'utf8'))
  if (Object.keys(input).sort().join(',') !== 'controlProjection,projection,source') {
    throw new Error('Recording input requires exactly source, projection and controlProjection')
  }
  return {
    source: decodeRecordingSource(input.source),
    projection: input.projection,
    controlProjection: input.controlProjection
  }
}
