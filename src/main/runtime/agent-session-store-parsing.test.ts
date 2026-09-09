import { describe, expect, it } from 'vitest'
import { parseState } from './agent-session-store-parsing'

const state = {
  schemaVersion: 3,
  hostId: 'host-1',
  records: {},
  operations: {},
  retiredClaimKeys: [],
  unusableRecords: {},
  hiveSessions: {}
}
describe('product metadata schema upgrade boundary', () => {
  it('upgrades v2 while requiring the product collection in v3', () => {
    const { hiveSessions: _hive, ...old } = state
    expect(parseState(JSON.stringify({ ...old, schemaVersion: 2 }), 'host-1')?.needsRewrite).toBe(
      true
    )
    expect(parseState(JSON.stringify(old), 'host-1')).toBeNull()
    expect(parseState(JSON.stringify(state), 'host-1')?.needsRewrite).toBe(false)
  })
  it('rejects corrupt current metadata without dropping it into an empty writable store', () => {
    for (const patch of [
      { hiveSessions: [] },
      { hiveSessions: { wrong: {} } },
      { hiveRecoveryFenceAt: -1 },
      { operations: { wrong: {} } },
      { visibleSessionIds: [123] }
    ]) {
      expect(parseState(JSON.stringify({ ...state, ...patch }), 'host-1')).toBeNull()
    }
  })
  it('preserves the future-schema latch even when future product shapes are unknown', () => {
    const result = parseState(
      JSON.stringify({
        ...state,
        schemaVersion: 99,
        hiveSessions: { future: { schemaVersion: 99 } },
        hiveRecoveryFenceAt: 'future'
      }),
      'host-1'
    )
    expect(result?.state.schemaVersion).toBe(99)
    expect(result?.needsRewrite).toBe(false)
  })
})
