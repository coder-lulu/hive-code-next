import { describe, expect, it } from 'vitest'
import { parseState } from './agent-session-store-parsing'
import { AGENT_SESSION_STORE_SCHEMA_VERSION } from './agent-session-store-contract'

const state = {
  schemaVersion: AGENT_SESSION_STORE_SCHEMA_VERSION,
  hostId: 'host-1',
  records: {},
  operations: {},
  retiredClaimKeys: [],
  unusableRecords: {},
  hiveSessions: {},
  taskExecutions: {}
}
describe('product metadata schema upgrade boundary', () => {
  it('migrates earlier records and requires both product collections in the current schema', () => {
    const { hiveSessions: _hive, ...old } = state
    expect(parseState(JSON.stringify({ ...old, schemaVersion: 2 }), 'host-1')?.needsRewrite).toBe(
      true
    )
    expect(parseState(JSON.stringify(old), 'host-1')).toBeNull()
    expect(parseState(JSON.stringify(state), 'host-1')?.needsRewrite).toBe(false)
    const { taskExecutions: _tasks, ...previous } = state
    expect(
      parseState(JSON.stringify({ ...previous, schemaVersion: 3 }), 'host-1')?.needsRewrite
    ).toBe(true)
    expect(parseState(JSON.stringify(previous), 'host-1')).toBeNull()
  })
  it('rejects corrupt current metadata without dropping it into an empty writable store', () => {
    for (const patch of [
      { hiveSessions: [] },
      { hiveSessions: { wrong: {} } },
      { taskExecutions: [] },
      { taskExecutions: { wrong: {} } },
      { taskRecoveryBlocked: 'false' },
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
