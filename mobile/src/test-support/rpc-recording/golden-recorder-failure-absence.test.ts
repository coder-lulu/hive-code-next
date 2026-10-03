import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readGolden, readGoldenRaw, type GoldenRecording } from './golden-recording'
import { OBSERVATION_FIELDS } from './golden-value-pool'
import { readHiveGoldenDomain } from '../hive-golden-domain'
import type { Observation } from './recording-scenario'
import type { RecordedValue } from './recording-values'

const root = resolve(import.meta.dirname, '../../../..')
const directory =
  process.env.RPC_FOUNDATION_GOLDENS ?? resolve(root, 'mobile/rpc-foundation/goldens')

/** `captureValue`'s two refusals. Neither is ever product behaviour. */
const PROJECTION_REFUSALS = [
  'Unsupported observation',
  'Observation requires an explicit projection'
]

function refusalText(value: RecordedValue): boolean {
  if (typeof value === 'string') {
    return PROJECTION_REFUSALS.some((refusal) => value.includes(refusal))
  }
  if (Array.isArray(value)) {
    return value.some(refusalText)
  }
  return typeof value === 'object' && value !== null && Object.values(value).some(refusalText)
}

function failures(at: string, observation: Observation): string[] {
  const found: string[] = []
  for (const field of OBSERVATION_FIELDS) {
    if (refusalText(observation[field])) {
      found.push(`${at}.${field}: recorder refused to project a value`)
    }
  }
  return found
}

/**
 * A refused projection settles as data — the throw is captured as an effect and the action stays
 * `pending` — so `--record` writes it and the suite goes green over it. Two adapters shipped that
 * way (#20667, and the worktree catalog), and a revert plus a re-record would restore either one
 * silently. A detached rejection is not banned here: recording one is how a real main bug gets
 * pinned, and `unhandled-recording.test.ts` pins the capture itself.
 */
describe('recorder failures never reach a golden', () => {
  it('detects a refused projection in every observation field that can carry one', () => {
    // Positive control: absence proves nothing unless the detector fires. `effects` carries the
    // shape both real defects took — the refusal captured as the message of a recorded error.
    const seeded: Observation = {
      sender: [],
      payloads: [],
      settlements: { fetch: { status: 'pending' } },
      state: { fetched: 'Observation requires an explicit projection for non-plain objects' },
      effects: [
        { name: 'unhandled-rejection', value: { message: 'Unsupported observation: function' } }
      ]
    }
    expect(failures('seeded', seeded)).toEqual([
      'seeded.state: recorder refused to project a value',
      'seeded.effects: recorder refused to project a value'
    ])
  })

  function scan(
    ids: readonly string[],
    read: (directory: string, id: string) => GoldenRecording
  ): { found: string[]; checkpoints: number } {
    let checkpoints = 0
    const found = ids.flatMap((id) =>
      read(directory, id).recording.checkpoints.flatMap((checkpoint) => {
        checkpoints++
        return failures(`${id}/${checkpoint.id}`, checkpoint.observation)
      })
    )
    return { found, checkpoints }
  }

  const domain = readHiveGoldenDomain(directory)

  it('keeps every raw reference free of recorder projection failures', () => {
    const result = scan(domain.upstreamIds, readGoldenRaw)
    if (domain.kind === 'hive-overlay') {
      expect(domain.upstreamIds).toHaveLength(794)
    }
    expect(result.found).toEqual([])
    expect(result.checkpoints).toBeGreaterThan(domain.upstreamIds.length)
  })

  it('keeps every product materialized reference free of projection failures', () => {
    const result = scan(domain.supportedIds, readGolden)
    if (domain.kind === 'hive-overlay') {
      expect(domain.supportedIds).toHaveLength(755)
    }
    expect(result.found).toEqual([])
    expect(result.checkpoints).toBeGreaterThan(domain.supportedIds.length)
  })
})
