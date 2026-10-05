import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import {
  openTestAgentSessionRecordStore,
  editPersistedTestAgentSessionStore,
  readPersistedTestAgentSessionStore
} from './agent-session-record-store-test-harness'
import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { agentSessionStorePath, loadAgentSessionStore } from './agent-session-record-store-file'
import type { AgentSessionReserveRequest } from './agent-session-reservation-admission'

const NOW = 1_800_000_000_000
const SESSION_ID = 'session-alpha-1'
let directory: string

function reserveRequest(): AgentSessionReserveRequest {
  return {
    sessionId: SESSION_ID,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'git-worktree'
    },
    provider: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: '/home/user/.codex' },
    expectedFence: null,
    spawnToken: 'spawn-new',
    claimKeyId: 'key-1',
    handoffOperationId: null,
    probe: { outcome: 'reservation-unused' },
    operation: {
      callerKey: 'client-1',
      operationId: `${NOW}-00000000000000000000000000000001`,
      fingerprint: 'fp-1'
    },
    now: NOW
  }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-agent-session-unsupported-'))
})

afterEach(async () => {
  closeTestJournalHostDatabases()
  await rm(directory, { recursive: true, force: true })
})

describe('unsupported agent session record schema', () => {
  it('quarantines without upgrading and keeps the session fail-closed', async () => {
    const unsupported = { ...agentSessionRecordFixture(), schemaVersion: 1 }
    await editPersistedTestAgentSessionStore(directory, (state) => {
      state.unusableRecords[SESSION_ID] = { reason: 'unsupported_schema', raw: unsupported }
    })
    const store = await openTestAgentSessionRecordStore(directory)

    expect(store.getRecord(SESSION_ID)).toBeNull()
    expect(store.isSessionUnreadable(SESSION_ID)).toBe(true)
    await expect(store.reserveOwner(reserveRequest())).rejects.toThrow(
      'execution_owner_reconciling'
    )
    const persisted = await readPersistedTestAgentSessionStore(directory)
    expect(persisted.records[SESSION_ID]).toEqual(unsupported)
    expect(store.getRecord(SESSION_ID)).toBeNull()
  })

  it('rejects an ad-hoc store schema without rewriting it', async () => {
    const filePath = agentSessionStorePath(directory)
    const payload = JSON.stringify({
      schemaVersion: 1,
      hostId: 'local',
      records: {},
      operations: {},
      retiredClaimKeys: [],
      unusableRecords: {}
    })
    await writeFile(filePath, payload)

    await expect(loadAgentSessionStore(filePath, 'local')).rejects.toThrow(
      'agent_session_store_corrupt'
    )
    await expect(readFile(filePath, 'utf-8')).resolves.toBe(payload)
  })
})
