import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  openTestAgentSessionRecordStore,
  importTestLegacyAgentSessionRecordStore,
  readPersistedTestAgentSessionStore
} from '../runtime/agent-session-record-store-test-harness'
import { legacyAgentSessionStorePath } from '../runtime/agent-session-record-store-file'
import { AGENT_SESSION_STORE_SCHEMA_VERSION as VER } from '../runtime/agent-session-store-contract'
import {
  closeTestJournalHostDatabases,
  openTestJournalHostDatabase
} from './agent-session-journal/journal-host-database-test-support'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hive-store-migration-'))
})
afterEach(async () => {
  closeTestJournalHostDatabases()
  await rm(root, { recursive: true, force: true })
})

it('imports v2 without changing its backup and rejects corrupted Hive metadata', async () => {
  const migrationRoot = join(root, 'legacy-v2')
  const path = legacyAgentSessionStorePath(migrationRoot)
  await mkdir(join(migrationRoot, 'agent-sessions'), { recursive: true })
  const v2 = JSON.stringify({
    schemaVersion: 2,
    hostId: 'host-1',
    records: {},
    operations: {},
    retiredClaimKeys: [],
    unusableRecords: {}
  })
  await writeFile(path, v2)
  await writeFile(`${path}.bak`, v2)
  const imported = await importTestLegacyAgentSessionRecordStore(migrationRoot, {
    hostId: 'host-1'
  })
  expect(imported.hive.list()).toEqual([])
  expect(
    (await readPersistedTestAgentSessionStore(migrationRoot, { hostId: 'host-1' })).schemaVersion
  ).toBe(VER)
  expect(await readFile(path, 'utf8')).toBe(v2)
  expect(await readFile(`${path}.bak`, 'utf8')).toBe(v2)
  const database = openTestJournalHostDatabase(migrationRoot).db
  database
    .prepare("UPDATE agent_session_store_meta SET value = ? WHERE key = 'hive_runtime_state'")
    .run(JSON.stringify({ hostId: 'host-1', hiveSessions: { bad: {} }, taskExecutions: {} }))
  await expect(
    openTestAgentSessionRecordStore(migrationRoot, { hostId: 'host-1' })
  ).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe(v2)
})
