import { describe, expect, it } from 'vitest'
import { isAgentSessionRecord } from './agent-session-record'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from './agent-session-record.test-fixture'
import {
  AgentSessionExecutionHostDeathSchema,
  AgentSessionExecutionHostProbeSchema,
  isAgentSessionDeathEvidence
} from './agent-session-execution-host-proof'

const source = {
  kind: 'task_execution' as const,
  runtimeRecordId: 'runtime:proof',
  ownershipEpoch: 1,
  executionId: 'execution:proof',
  executionEpoch: 1,
  commandFingerprint: 'a'.repeat(64)
}
const witness = {
  sessionId: 'session-alpha-1',
  hostId: 'local' as const,
  source,
  ownerFence: 7,
  spawnToken: 'spawn-owner',
  daemonId: 'daemon:proof',
  containerId: 'b'.repeat(64),
  imageId: `sha256:${'c'.repeat(64)}`
}
const death = {
  kind: 'execution-host-exit-observed' as const,
  detail: 'original CID exited',
  observedAt: 40000,
  ownerFence: 7,
  lastProvenAliveAt: 30000,
  witness
}

describe('execution host proof persistence', () => {
  it('strictly rejects unbounded, extra, malformed or incomplete host evidence', () => {
    const invalid = [
      { ...witness, containerId: 'b' },
      { ...witness, hostId: 'remote' },
      { ...witness, extra: true },
      { ...witness, ownerFence: 0 },
      { ...witness, daemonId: 'd'.repeat(513) },
      { ...witness, source: { ...source, extra: true } }
    ]
    for (const value of invalid) {
      expect(
        AgentSessionExecutionHostProbeSchema.safeParse({
          outcome: 'execution-host-exited',
          witness: value
        }).success
      ).toBe(false)
    }
    expect(
      AgentSessionExecutionHostDeathSchema.safeParse({ ...death, ownerFence: 8 }).success
    ).toBe(false)
    expect(
      AgentSessionExecutionHostDeathSchema.safeParse({ ...death, lastProvenAliveAt: 40001 }).success
    ).toBe(false)
    expect(
      AgentSessionExecutionHostProbeSchema.safeParse({ outcome: 'execution-host-exited' }).success
    ).toBe(false)
  })
  it('requires the persisted death witness to match the released original Session source and token', () => {
    const record = {
      ...agentSessionRecordFixture(
        agentSessionLeaseFixture({
          runtimeFence: 8,
          claimStatus: 'released',
          ownerProcess: null,
          reservedSpawnToken: null,
          deathEvidence: death
        })
      ),
      provider: 'codex' as const,
      accountHome: { variable: 'CODEX_HOME' as const, path: '/managed/proof' },
      taskSource: source,
      providerHandleChain: []
    }
    expect(isAgentSessionRecord(record)).toBe(true)
    expect(isAgentSessionRecord({ ...record, taskSource: { ...source, ownershipEpoch: 2 } })).toBe(
      false
    )
    expect(isAgentSessionRecord({ ...record, lease: { ...record.lease, runtimeFence: 7 } })).toBe(
      false
    )
    expect(
      isAgentSessionRecord({
        ...record,
        lease: {
          ...record.lease,
          deathEvidence: { ...death, witness: { ...witness, spawnToken: 'new-token' } }
        }
      })
    ).toBe(true)
    // Original Task binding validation supplies the token/CID cross-check unavailable to the Session decoder alone.
  })
  it('keeps ordinary process evidence readable without inventing a CID witness', () => {
    expect(
      isAgentSessionDeathEvidence({ kind: 'pid-absent', detail: 'process absent', observedAt: 10 })
    ).toBe(true)
    expect(
      isAgentSessionDeathEvidence({
        kind: 'execution-host-exit-observed',
        detail: 'CLI exited',
        observedAt: 10
      })
    ).toBe(false)
  })
})
