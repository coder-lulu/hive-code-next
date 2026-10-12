import { describe, expect, it } from 'vitest'
import { parseState } from './agent-session-store-parsing'
import { AGENT_SESSION_STORE_SCHEMA_VERSION } from './agent-session-store-contract'

const state = {
  schemaVersion: AGENT_SESSION_STORE_SCHEMA_VERSION,
  hostId: 'host-1',
  records: {},
  operations: {},
  retiredClaimKeys: [],
  unusableRecords: {}
}
describe('product metadata schema upgrade boundary', () => {
  it('migrates earlier records and reads current native session metadata', () => {
    expect(parseState(JSON.stringify({ ...state, schemaVersion: 2 }), 'host-1')?.needsRewrite).toBe(
      true
    )
    expect(parseState(JSON.stringify(state), 'host-1')?.needsRewrite).toBe(false)
  })
  it('rejects corrupt current metadata without dropping it into an empty writable store', () => {
    for (const patch of [{ operations: { wrong: {} } }, { visibleSessionIds: [123] }]) {
      expect(parseState(JSON.stringify({ ...state, ...patch }), 'host-1')).toBeNull()
    }
  })
  it('preserves the future-schema latch even when future product shapes are unknown', () => {
    const result = parseState(
      JSON.stringify({
        ...state,
        schemaVersion: 99,
        futureMetadata: { schemaVersion: 99 }
      }),
      'host-1'
    )
    expect(result?.state.schemaVersion).toBe(99)
    expect(result?.needsRewrite).toBe(false)
  })
})
