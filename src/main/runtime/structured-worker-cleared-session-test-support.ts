import { expect } from 'vitest'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { openTestAgentSessionRecordStore } from './agent-session-record-store-test-harness'
import { applyAgentSessionRestartAdjudication } from './agent-session-restart-lease-transitions'
import type { AgentSessionRecordStore } from './agent-session-record-store'
import type {
  AgentSessionExecutionLocation,
  AgentSessionRecord
} from '../../shared/agent-session-record'

export async function reserveClearedWorkerSuccessor(
  directory: string,
  sessionId: string,
  location: AgentSessionExecutionLocation,
  operationId: string,
  now: number
) {
  const store = await openTestAgentSessionRecordStore(directory)
  const reserved = await store.reserveOwner({
    sessionId,
    location,
    provider: 'claude',
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/home/dev/.claude' },
    expectedFence: null,
    spawnToken: 'spawn-a',
    claimKeyId: 'key-1',
    handoffOperationId: operationId,
    probe: { outcome: 'indeterminate', reason: 'no answer' },
    operation: { callerKey: 'client-1', operationId, fingerprint: 'fp-1' },
    now
  })
  return { store, reserved: reserved.record }
}

export function settleClearedWorkerFailedAcquisition(
  store: AgentSessionRecordStore,
  reserved: AgentSessionRecord,
  operationId: string,
  now: number
) {
  return store.settleFailedAcquisition({
    sessionId: reserved.sessionId,
    fence: reserved.lease.runtimeFence,
    spawnToken: 'spawn-a',
    callerKey: 'client-1',
    operationId,
    outcome: { status: 'failed', code: 'agent_session_operation_invalid', message: 'failed' },
    exitProof: 'unproven',
    now
  })
}

export async function adjudicateClearedWorkerAfterColdRestart(
  directory: string,
  sessionId: string,
  now: number
) {
  closeTestJournalHostDatabase(directory)
  const restarted = await openTestAgentSessionRecordStore(directory)
  const loaded = restarted.getRecord(sessionId)
  expect(loaded?.lease.unreconciled).toBe(true)
  if (!loaded) {
    throw new Error('successor missing after a cold restart')
  }
  const recovered = applyAgentSessionRestartAdjudication({
    record: loaded,
    probe: { outcome: 'indeterminate', reason: 'no answer' },
    now
  })
  closeTestJournalHostDatabase(directory)
  const stored = (await openTestAgentSessionRecordStore(directory)).getRecord(sessionId)
  return { loaded, recovered, stored }
}

export async function proveUnsettledClearedWorkerSurvivesColdRestart(
  directory: string,
  sessionId: string,
  location: AgentSessionExecutionLocation,
  operationId: string,
  now: number
) {
  const { reserved } = await reserveClearedWorkerSuccessor(
    directory,
    sessionId,
    location,
    operationId,
    now
  )
  const { loaded, recovered, stored } = await adjudicateClearedWorkerAfterColdRestart(
    directory,
    sessionId,
    now + 1
  )
  expect(loaded.lease).toMatchObject({ unreconciled: true, reservedSpawnToken: 'spawn-a' })
  expect(recovered.lease).toMatchObject({
    claimStatus: 'reserved',
    runtimeFence: reserved.lease.runtimeFence,
    reservedSpawnToken: 'spawn-a',
    handoffStage: 'recovering',
    unreconciled: false,
    deathEvidence: null,
    lastRenewedAt: now
  })
  expect(stored).toEqual(loaded)
  return recovered
}

export async function recoverFailedClearedWorkerAfterColdRestart(
  directory: string,
  sessionId: string,
  location: AgentSessionExecutionLocation,
  operationId: string,
  now: number
) {
  const { store, reserved } = await reserveClearedWorkerSuccessor(
    directory,
    sessionId,
    location,
    operationId,
    now
  )
  const settled = await settleClearedWorkerFailedAcquisition(store, reserved, operationId, now + 1)
  expect(settled.lease).toMatchObject({
    claimStatus: 'released',
    reservedSpawnToken: null,
    deathEvidence: null
  })
  const { recovered } = await adjudicateClearedWorkerAfterColdRestart(directory, sessionId, now + 2)
  return recovered
}
