import { describe, expect, it } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import { encodeAgentSessionRecord } from '../../shared/agent-session-record-stored-form'
import { parseState } from './agent-session-store-parsing'
import { AGENT_SESSION_STORE_SCHEMA_VERSION } from './agent-session-store-contract'

describe('native session records after task service removal', () => {
  it.each(['task-source', 'container-exit'])(
    'loads ordinary records while quarantining retired %s metadata',
    (kind) => {
      const native = agentSessionRecordFixture()
      const retired = {
        ...encodeAgentSessionRecord(native),
        sessionId: 'retired-task-session',
        ...(kind === 'task-source' ? { taskSource: {} } : {})
      }
      const retiredLease = {
        ...retired.lease,
        sessionId: retired.sessionId,
        ...(kind === 'container-exit'
          ? {
              deathEvidence: {
                kind: 'execution-host-exit-observed',
                detail: 'retired execution host receipt',
                observedAt: 30_000,
                ownerFence: 7
              }
            }
          : {})
      }
      const stored = { ...retired, lease: retiredLease }
      const parsed = parseState(
        JSON.stringify({
          schemaVersion: AGENT_SESSION_STORE_SCHEMA_VERSION,
          hostId: 'host-native',
          records: {
            [native.sessionId]: encodeAgentSessionRecord(native),
            [retired.sessionId]: stored
          },
          operations: {},
          retiredClaimKeys: [],
          unusableRecords: {}
        }),
        'host-native'
      )

      expect(parsed?.state.records.get(native.sessionId)).toEqual(native)
      expect(parsed?.state.records.has(retired.sessionId)).toBe(false)
      expect(parsed?.state.unreadableRecords.get(retired.sessionId)).toEqual({
        reason: 'current_shape_invalid',
        raw: stored
      })
    }
  )
})
