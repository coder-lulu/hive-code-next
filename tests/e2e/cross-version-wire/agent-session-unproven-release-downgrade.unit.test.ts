import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, expect, test } from 'vitest'
import { resolveStructuredSessionRecovery } from '../../../src/main/native-chat/agent-session-wire/structured-agent-session-recovery-resolution'
import { AgentSessionRecordStore } from '../../../src/main/runtime/agent-session-record-store'
import { agentSessionStorePath } from '../../../src/main/runtime/agent-session-record-store-file'
import { agentSessionStoreBackupPath } from '../../../src/main/runtime/agent-session-record-store-write'
import {
  importReleaseCheckoutModule,
  materializeReleaseCheckout,
  REPO_ROOT
} from './release-checkout'

// The pinned older release must still honor the owner retained by this build.
// v1.4.211, resolved from the official annotated tag; no mutable tag is required locally.
const BASELINE_REF = '5534462b50c660888487a2108700d4cf284270db'
const SESSION = 'session-unproven'
const NOW = 1_800_000_000_000
const LOCATION = {
  executionHostId: 'local' as const,
  wslDistro: null,
  workspaceId: 'workspace-1',
  workspaceKind: 'folder' as const
}

let OldStore: {
  open: (args: { directory: string; hostId: string }) => Promise<AgentSessionRecordStore>
}

beforeAll(async () => {
  const releasePackage = JSON.parse(
    execFileSync('git', ['show', `${BASELINE_REF}:package.json`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true
    })
  )
  expect(releasePackage.version).toBe('1.4.211')
  const checkout = await materializeReleaseCheckout(BASELINE_REF)
  expect(checkout.commit).toBe(BASELINE_REF)
  const baseline = await importReleaseCheckoutModule(
    checkout,
    'src/main/runtime/agent-session-record-store.ts'
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the pinned release exports this class with the open/read/reconcile/reserve members called below; a missing one fails the test.
  OldStore = baseline.AgentSessionRecordStore as typeof OldStore
})

function reserveRequest(expectedFence: number | null, spawnToken: string, operation: number) {
  return {
    sessionId: SESSION,
    location: LOCATION,
    provider: 'codex' as const,
    accountHome: { variable: 'CODEX_HOME' as const, path: '/tmp/codex' },
    // Older builds still read the owner kind from the request.
    runtimeKind: 'native' as const,
    expectedFence,
    spawnToken,
    claimKeyId: 'key-1',
    handoffOperationId: null,
    probe: { outcome: 'reservation-unused' as const },
    operation: {
      callerKey: 'test',
      operationId: `${NOW}-${String(operation).padStart(32, '0')}`,
      fingerprint: 'create'
    },
    now: NOW
  }
}

test('an older build reads the unproven owner but refuses to rewrite the newer store schema', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-unproven-release-downgrade-'))
  try {
    // An unknown owner may still be running; recovery cannot convert uncertainty into release.
    const store = await AgentSessionRecordStore.open({ directory, hostId: 'local' })
    const reserved = await store.reserveOwner(reserveRequest(null, 'spawn-a', 1))
    const fence = reserved.record.lease.runtimeFence
    await store.commitProcessIdentity({
      sessionId: SESSION,
      fence,
      process: { hostId: 'local', pid: 4242, processStartTimeMs: NOW, spawnToken: 'spawn-a' },
      now: NOW
    })
    await store.transitionHandoff(SESSION, (record) => ({
      ...record,
      lease: { ...record.lease, handoffStage: 'recovering' }
    }))
    const retainedLease = store.getRecord(SESSION)?.lease
    expect(retainedLease).toMatchObject({
      claimStatus: 'reserved',
      handoffStage: 'recovering',
      runtimeFence: fence,
      ownerProcess: { pid: 4242, spawnToken: 'spawn-a' },
      deathEvidence: null
    })
    await expect(
      resolveStructuredSessionRecovery(
        {
          store,
          probeRecord: async () => ({ outcome: 'indeterminate', reason: 'no start time' }),
          now: () => NOW
        },
        SESSION
      )
    ).resolves.toBe('unresolved')
    expect(store.getRecord(SESSION)?.lease).toEqual(retainedLease)
    await expect(store.reserveOwner(reserveRequest(fence, 'spawn-b', 2))).rejects.toThrow(
      'agent_session_ownership_unknown'
    )
    expect(store.getRecord(SESSION)?.lease).toEqual(retainedLease)

    // Hive's v4 store is readable by this v2 release, but no old transaction may rewrite it.
    const filePath = agentSessionStorePath(directory)
    const readPersistedStore = () => [
      readFileSync(filePath, 'utf8'),
      readFileSync(agentSessionStoreBackupPath(filePath), 'utf8')
    ]
    const persistedBefore = readPersistedStore()
    expect(JSON.parse(persistedBefore[0])).toMatchObject({ schemaVersion: 4 })
    const old = await OldStore.open({ directory, hostId: 'local' })
    expect(old.readOnly).toBe(true)
    expect(old.isSessionUnreadable(SESSION)).toBe(false)
    expect(old.getRecord(SESSION)?.lease).toMatchObject({
      claimStatus: 'reserved',
      handoffStage: 'recovering',
      runtimeFence: fence,
      ownerProcess: retainedLease?.ownerProcess,
      deathEvidence: null
    })
    const loadedLease = structuredClone(old.getRecord(SESSION)?.lease)
    expect(readPersistedStore()).toEqual(persistedBefore)
    await expect(
      old.reconcileOnRestart({
        probe: async () => ({ outcome: 'indeterminate', reason: 'no start time' }),
        now: NOW + 1
      })
    ).rejects.toThrow('agent_session_legacy_required')
    expect(old.getRecord(SESSION)?.lease).toEqual(loadedLease)
    expect(readPersistedStore()).toEqual(persistedBefore)
    await expect(old.reserveOwner(reserveRequest(fence, 'spawn-c', 3))).rejects.toThrow(
      'agent_session_legacy_required'
    )
    expect(old.getRecord(SESSION)?.lease).toEqual(loadedLease)
    expect(readPersistedStore()).toEqual(persistedBefore)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
