import { createHash } from 'node:crypto'
import type { Observation, Recording } from './recording-scenario'
import type { RecordedValue } from './recording-values'

type FieldShape = 'list' | 'map' | 'whole'

/**
 * How each observation field is interned. `sender`, `payloads` and `effects` are append-only
 * histories and `settlements` is keyed by action id, so every checkpoint after the first re-states
 * its predecessor's entries: pooling the whole field stored that shared prefix once per checkpoint,
 * and once per reply partition in a matrix golden. Interning per entry stores it once per file.
 *
 * Declared rather than sniffed from the value, so an empty list cannot be encoded as a map and a
 * projection that changes a field's container fails loudly instead of silently switching encodings.
 * `Record<keyof Observation, …>` makes a new observation field declare how it interns.
 */
import {
  canonicalRecordingJson as canonicalJson,
  OBSERVATION_FIELD_KINDS,
  OBSERVATION_FIELDS
} from '../../../../config/scripts/upstream-recording-inputs.mjs'
export { OBSERVATION_FIELDS }

export type ValuePool = Record<string, RecordedValue>
type InternedField<Shape extends FieldShape> = Shape extends 'list'
  ? string[]
  : Shape extends 'map'
    ? Record<string, string>
    : string
export type InternedObservation = {
  [Field in keyof typeof OBSERVATION_FIELD_KINDS]: InternedField<
    (typeof OBSERVATION_FIELD_KINDS)[Field]
  >
}
export type InternedRecording = {
  scenario: string
  checkpoints: { id: string; observation: InternedObservation }[]
}

export { canonicalRecordingJson as canonicalJson } from '../../../../config/scripts/upstream-recording-inputs.mjs'

export function valueHash(value: RecordedValue): string {
  return canonicalJsonHash(canonicalJson(value))
}

function canonicalJsonHash(json: string): string {
  return createHash('sha256').update(json).digest('hex').slice(0, 12)
}

function listEntries(at: string, value: RecordedValue): RecordedValue[] {
  if (!Array.isArray(value)) {
    throw new Error(`Observation field ${at} is declared a list but recorded ${typeof value}`)
  }
  return value
}

function mapEntries(at: string, value: RecordedValue): [string, RecordedValue][] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Observation field ${at} is declared a map but recorded ${typeof value}`)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the guard above rejected null and arrays, leaving a recorded object.
  return Object.entries(value as Record<string, RecordedValue>)
}

export function internRecording(recording: Recording): {
  values: ValuePool
  recording: InternedRecording
} {
  const pool: ValuePool = {}
  const canonical = new Map<string, string>()
  // Checkpoints repeat their append-only histories; hash each distinct entry once.
  const hashes = new Map<string, string>()
  const intern = (entry: RecordedValue, at: string): string => {
    const json = canonicalJson(entry)
    const hash = hashes.get(json) ?? canonicalJsonHash(json)
    hashes.set(json, hash)
    const seen = canonical.get(hash)
    if (seen !== undefined && seen !== json) {
      throw new Error(`Golden value hash collision at ${hash} (${at})`)
    }
    canonical.set(hash, json)
    pool[hash] = entry
    return hash
  }
  const checkpoints = recording.checkpoints.map((checkpoint) => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every declared field is assigned below before the value is read.
    const observation = {} as Record<keyof Observation, unknown>
    for (const field of OBSERVATION_FIELDS) {
      const value = checkpoint.observation[field]
      const at = `${checkpoint.id}.${field}`
      observation[field] =
        OBSERVATION_FIELD_KINDS[field] === 'list'
          ? listEntries(at, value).map((entry, index) => intern(entry, `${at}[${index}]`))
          : OBSERVATION_FIELD_KINDS[field] === 'map'
            ? Object.fromEntries(
                mapEntries(at, value).map(([key, entry]) => [key, intern(entry, `${at}.${key}`)])
              )
            : intern(value, at)
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each field was just encoded to the shape its declaration names.
    return { id: checkpoint.id, observation: observation as InternedObservation }
  })
  // Hash-ordered so a value's position in the pool does not move when checkpoints are reordered.
  const values = Object.fromEntries(
    Object.keys(pool)
      .sort()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: pool entries are the recorded values that were interned into it.
      .map((hash) => [hash, pool[hash] as RecordedValue])
  )
  return { values, recording: { scenario: recording.scenario, checkpoints } }
}

export { resolveRecording } from '../../../../config/scripts/upstream-recording-inputs.mjs'
