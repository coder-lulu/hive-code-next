import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../shared/agent-session-record.test-fixture'
import { encodeAgentSessionRecord } from '../../shared/agent-session-record-stored-form'
import {
  legacyAgentSessionStorePath,
  loadAgentSessionStore
} from './agent-session-record-store-file'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore,
  seedTestAgentSessionRecordStore
} from './agent-session-record-store-test-harness'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'

const NOW = 1_800_000_000_000
let directory: string
beforeEach(async () => {
  const root = resolve(
    'logs/upstream-sync/20261102/node-fixtures/source-final-next/import-fixtures'
  )
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'retired-'))
})
afterEach(async () => {
  closeTestJournalHostDatabase(directory)
  await rm(directory, { recursive: true, force: true })
})

function retiredRecord(ordinary: ReturnType<typeof encodeAgentSessionRecord>, kind: string) {
  if (kind === 'managed-pi') {
    return { ...ordinary, provider: 'managed-pi' }
  }
  if (kind === 'hivecode') {
    return { ...ordinary, provider: 'hivecode' }
  }
  if (kind === 'hivecode-handle' || kind === 'hivecode-stored-handle') {
    return {
      ...ordinary,
      providerHandleChain: ordinary.providerHandleChain.map((link) => ({
        ...link,
        handle:
          kind === 'hivecode-handle'
            ? { transport: 'acp', agent: 'hivecode', nativeId: 'retired-hive-session' }
            : { provider: 'hivecode', sessionId: 'retired-hive-session' }
      }))
    }
  }
  if (kind === 'managed-pi-handle') {
    return {
      ...ordinary,
      providerHandleChain: ordinary.providerHandleChain.map((link) => ({
        ...link,
        handle: { provider: 'managed-pi', sessionId: 'retired-managed-session' }
      }))
    }
  }
  if (kind === 'container-exit') {
    return {
      ...ordinary,
      lease: {
        ...ordinary.lease,
        deathEvidence: {
          kind: 'execution-host-exit-observed',
          detail: 'original container receipt',
          observedAt: NOW,
          ownerFence: 7
        }
      }
    }
  }
  return {
    ...ordinary,
    taskSource:
      kind === 'task-source-null'
        ? null
        : kind === 'task-source-malformed'
          ? 'malformed'
          : { retained: 'original task provenance' }
  }
}

describe('retired execution records stay quarantined in file recovery and current journal rows', () => {
  it.each(['shadowed-raw', 'invalid-metadata'])(
    'keeps retired primary evidence through %s fallback',
    async (scenario) => {
      const ordinary = encodeAgentSessionRecord(agentSessionRecordFixture())
      const retired = retiredRecord(ordinary, 'task-source')
      const base = {
        schemaVersion: 4,
        hostId: 'local',
        operations: {},
        retiredClaimKeys: []
      }
      const path = legacyAgentSessionStorePath(directory)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(
        path,
        JSON.stringify({
          ...base,
          records: { [ordinary.sessionId]: retired },
          unusableRecords:
            scenario === 'shadowed-raw'
              ? { [ordinary.sessionId]: { reason: 'current_shape_invalid', raw: { broken: true } } }
              : {},
          ...(scenario === 'invalid-metadata' ? { operations: [] } : {})
        })
      )
      await writeFile(
        `${path}.bak`,
        JSON.stringify({
          ...base,
          records: { [ordinary.sessionId]: ordinary },
          unusableRecords: {}
        })
      )
      const loaded = await loadAgentSessionStore(path, 'local')
      expect(loaded.state.records.has(ordinary.sessionId)).toBe(false)
      expect(loaded.state.unreadableRecords.has(ordinary.sessionId)).toBe(true)
      expect(loaded.state.unreadableRecords.get(ordinary.sessionId)?.raw).toEqual(retired)
    }
  )

  it.each(['task-source', 'container-exit'])(
    'retains %s evidence from a contradictory per-record backup',
    async (kind) => {
      const ordinary = encodeAgentSessionRecord(agentSessionRecordFixture())
      const retired = retiredRecord(ordinary, kind)
      const base = {
        schemaVersion: 4,
        hostId: 'local',
        operations: {},
        retiredClaimKeys: []
      }
      const path = legacyAgentSessionStorePath(directory)
      await mkdir(dirname(path), { recursive: true })
      const primary = JSON.stringify({
        ...base,
        records: { [ordinary.sessionId]: { broken: true } },
        unusableRecords: {}
      })
      const backup = JSON.stringify({
        ...base,
        records: { [ordinary.sessionId]: ordinary },
        unusableRecords: { [ordinary.sessionId]: { reason: 'current_shape_invalid', raw: retired } }
      })
      await writeFile(path, primary)
      await writeFile(`${path}.bak`, backup)
      const loaded = await loadAgentSessionStore(path, 'local')
      expect(loaded.state.records.has(ordinary.sessionId)).toBe(false)
      expect(loaded.state.unreadableRecords.has(ordinary.sessionId)).toBe(true)
      expect(loaded.state.unreadableRecords.get(ordinary.sessionId)?.raw).toEqual(retired)
      expect(await readFile(path, 'utf8')).toBe(primary)
      expect(await readFile(`${path}.bak`, 'utf8')).toBe(backup)
    }
  )

  it.each(['damaged-record', 'truncated-file'])(
    'keeps %s file evidence out of the current store without replacing a valid owner',
    async (scenario) => {
      const ordinary = encodeAgentSessionRecord(agentSessionRecordFixture())
      const damaged = {
        ...ordinary,
        provider: 'damaged',
        lease: { ...ordinary.lease, runtimeFence: 50 }
      }
      const state = (record: unknown) => ({
        schemaVersion: 4,
        hostId: 'local',
        records: { [ordinary.sessionId]: record },
        operations: {},
        retiredClaimKeys: [],
        unusableRecords: {}
      })
      const path = legacyAgentSessionStorePath(directory)
      await mkdir(dirname(path), { recursive: true })
      const primary = scenario === 'truncated-file' ? '{"records":' : JSON.stringify(state(damaged))
      const backup = JSON.stringify(state(ordinary))
      await writeFile(path, primary)
      await writeFile(`${path}.bak`, backup)

      // The retained reader may read a backup; it grants no current journal ownership.
      const loaded = await loadAgentSessionStore(path, 'local')
      expect(loaded.state.records.get(ordinary.sessionId)?.lease).toEqual(ordinary.lease)
      expect(loaded.recoveredFromBackup).toBe(scenario === 'truncated-file')
      if (scenario === 'damaged-record') {
        expect(loaded.state.unreadableRecords.get(ordinary.sessionId)?.raw).toEqual(damaged)
      }
      const empty = await openTestAgentSessionRecordStore(directory)
      expect(empty.getRecord(ordinary.sessionId)).toBeNull()
      expect(empty.listRecords()).toEqual([])

      const current = agentSessionRecordFixture(agentSessionLeaseFixture({ runtimeFence: 83 }))
      await seedTestAgentSessionRecordStore(directory, { records: [current] })
      const ownerBefore = (await openTestAgentSessionRecordStore(directory)).getRecord(
        current.sessionId
      )
      // Opening the current journal requires fresh owner proof, independently of legacy files.
      expect(ownerBefore).toEqual({
        ...current,
        lease: { ...current.lease, unreconciled: true }
      })
      await loadAgentSessionStore(path, 'local')
      const reopened = await openTestAgentSessionRecordStore(directory)
      expect(reopened.getRecord(current.sessionId)).toEqual(ownerBefore)
      expect(reopened.getRecord(current.sessionId)?.lease).toEqual(ownerBefore?.lease)
      expect((await readPersistedTestAgentSessionStore(directory)).records).toEqual({
        [current.sessionId]: encodeAgentSessionRecord(current)
      })
      expect(await readFile(path, 'utf8')).toBe(primary)
      expect(await readFile(`${path}.bak`, 'utf8')).toBe(backup)
    }
  )

  it.each([
    'task-source',
    'task-source-null',
    'task-source-malformed',
    'container-exit',
    'managed-pi',
    'managed-pi-handle',
    'hivecode',
    'hivecode-handle',
    'hivecode-stored-handle'
  ])('%s cannot be replaced by an ordinary same-id record', async (kind) => {
    const ordinary = encodeAgentSessionRecord(agentSessionRecordFixture())
    const retired = retiredRecord(ordinary, kind)
    const state = (records: Record<string, unknown>, unusableRecords = {}) => ({
      schemaVersion: 4,
      hostId: 'local',
      records,
      unusableRecords,
      operations: {},
      retiredClaimKeys: []
    })
    const path = legacyAgentSessionStorePath(directory)
    await mkdir(dirname(path), { recursive: true })
    const primary = JSON.stringify(state({ [ordinary.sessionId]: retired }))
    const backup = JSON.stringify(state({ [ordinary.sessionId]: ordinary }))
    await writeFile(path, primary)
    await writeFile(`${path}.bak`, backup)
    const loaded = await loadAgentSessionStore(path, 'local')
    expect(loaded.state.records.has(ordinary.sessionId)).toBe(false)
    expect(loaded.state.unreadableRecords.has(ordinary.sessionId)).toBe(true)
    expect(loaded.state.unreadableRecords.get(ordinary.sessionId)?.raw).toEqual(retired)
    // The current journal row reader independently rejects raw retired provenance.
    const db = openTestJournalHostDatabase(directory).db
    db.prepare('INSERT INTO agent_session_records (session_id, record_json) VALUES (?, ?)').run(
      ordinary.sessionId,
      JSON.stringify(retired)
    )
    const store = await openTestAgentSessionRecordStore(directory)
    expect(store.getRecord(ordinary.sessionId)).toBeNull()
    expect(store.isSessionUnreadable(ordinary.sessionId)).toBe(true)
    expect(
      (await readPersistedTestAgentSessionStore(directory)).records[ordinary.sessionId]
    ).toEqual(retired)
    await expect(
      store.reserveOwner({
        sessionId: ordinary.sessionId,
        location: ordinary.location,
        provider: 'claude',
        accountHome: ordinary.accountHome,
        expectedFence: null,
        spawnToken: 'new-native-spawn',
        claimKeyId: 'key-new',
        handoffOperationId: null,
        probe: { outcome: 'reservation-unused' },
        operation: {
          callerKey: 'test',
          operationId: `${NOW}-${'a'.repeat(32)}`,
          fingerprint: 'retired-import'
        },
        now: NOW
      })
    ).rejects.toThrow('execution_owner_reconciling')
    expect(await readFile(path, 'utf8')).toBe(primary)
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(backup)
  })

  it.each([
    'task-source',
    'task-source-null',
    'task-source-malformed',
    'container-exit',
    'managed-pi',
    'managed-pi-handle',
    'hivecode',
    'hivecode-handle',
    'hivecode-stored-handle'
  ])('retains rejected %s bytes when the file already holds a same-id salvage', async (kind) => {
    const ordinary = encodeAgentSessionRecord(agentSessionRecordFixture())
    const retired = retiredRecord(ordinary, kind)
    const path = legacyAgentSessionStorePath(directory)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 4,
        hostId: 'local',
        records: { [ordinary.sessionId]: ordinary },
        unusableRecords: {
          [ordinary.sessionId]: { reason: 'current_shape_invalid', raw: retired }
        },
        operations: {},
        retiredClaimKeys: []
      })
    )
    const loaded = await loadAgentSessionStore(path, 'local')
    expect(loaded.state.records.has(ordinary.sessionId)).toBe(false)
    expect(loaded.state.unreadableRecords.has(ordinary.sessionId)).toBe(true)
    expect(loaded.state.unreadableRecords.get(ordinary.sessionId)?.raw).toEqual(retired)
  })
})
