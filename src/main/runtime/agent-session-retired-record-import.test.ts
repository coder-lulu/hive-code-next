import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import { encodeAgentSessionRecord } from '../../shared/agent-session-record-stored-form'
import { legacyAgentSessionStorePath } from './agent-session-record-store-file'
import {
  importTestLegacyAgentSessionRecordStore,
  readPersistedTestAgentSessionStore
} from './agent-session-record-store-test-harness'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'

const NOW = 1_800_000_000_000
let directory: string
beforeEach(async () => {
  const root = resolve('logs/paperclip-removal/recheck-3/import-fixtures')
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

describe('retired execution records stay quarantined through legacy import', () => {
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
      const store = await importTestLegacyAgentSessionRecordStore(directory)
      expect(store.getRecord(ordinary.sessionId)).toBeNull()
      expect(store.isSessionUnreadable(ordinary.sessionId)).toBe(true)
      expect(
        (await readPersistedTestAgentSessionStore(directory)).records[ordinary.sessionId]
      ).toEqual(retired)
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
      const store = await importTestLegacyAgentSessionRecordStore(directory)
      expect(store.getRecord(ordinary.sessionId)).toBeNull()
      expect(store.isSessionUnreadable(ordinary.sessionId)).toBe(true)
      expect(
        (await readPersistedTestAgentSessionStore(directory)).records[ordinary.sessionId]
      ).toEqual(retired)
      expect(await readFile(path, 'utf8')).toBe(primary)
      expect(await readFile(`${path}.bak`, 'utf8')).toBe(backup)
    }
  )

  it.each(['damaged-record', 'truncated-file'])(
    'preserves ordinary %s backup recovery and fence floor',
    async (scenario) => {
      const ordinary = encodeAgentSessionRecord(agentSessionRecordFixture())
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
      await writeFile(
        path,
        scenario === 'truncated-file'
          ? '{"records":'
          : JSON.stringify(
              state({
                ...ordinary,
                provider: 'damaged',
                lease: { ...ordinary.lease, runtimeFence: 50 }
              })
            )
      )
      await writeFile(`${path}.bak`, JSON.stringify(state(ordinary)))
      const store = await importTestLegacyAgentSessionRecordStore(directory)
      expect(store.getRecord(ordinary.sessionId)?.lease).toMatchObject({
        runtimeFence: 7,
        minimumNextFence: scenario === 'damaged-record' ? 51 : 9,
        unreconciled: true
      })
      expect(store.isSessionUnreadable(ordinary.sessionId)).toBe(false)
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
    const store = await importTestLegacyAgentSessionRecordStore(directory)
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
    const store = await importTestLegacyAgentSessionRecordStore(directory)
    expect(store.getRecord(ordinary.sessionId)).toBeNull()
    expect(store.isSessionUnreadable(ordinary.sessionId)).toBe(true)
    expect(
      (await readPersistedTestAgentSessionStore(directory)).records[ordinary.sessionId]
    ).toEqual(retired)
  })
})
