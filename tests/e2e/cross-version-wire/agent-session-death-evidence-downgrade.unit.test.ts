import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, expect, test } from 'vitest'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../../src/shared/agent-session-record.test-fixture'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore,
  readPersistedTestAgentSessionStoreText,
  seedTestAgentSessionRecordStore
} from '../../../src/main/runtime/agent-session-record-store-test-harness'
import { closeTestJournalHostDatabase } from '../../../src/main/native-chat/agent-session-journal/journal-host-database-test-support'
import { agentSessionStorePath } from '../../../src/main/runtime/agent-session-record-store-file'
import { importReleaseCheckoutModule, materializeReleaseCheckout } from './release-checkout'

// The last release before a proof of death named its owner and its last proof of life.
// Official v1.4.211, pinned independently of product release refs.
const BASELINE_REF = '5534462b50c660888487a2108700d4cf284270db'
const SESSION = 'session-alpha-1'
let baseline: Awaited<ReturnType<typeof importReleaseCheckoutModule>>

beforeAll(async () => {
  const checkout = await materializeReleaseCheckout(BASELINE_REF)
  expect(checkout.commit).toBe(BASELINE_REF)
  baseline = await importReleaseCheckoutModule(
    checkout,
    'src/main/runtime/agent-session-record-store.ts'
  )
})

test('an actual older record parser reads a committed proof of death naming its owner and last proof of life', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-death-evidence-downgrade-'))
  try {
    // A live owner at fence 7, last renewed at 30000, found gone when this build relaunches.
    await seedTestAgentSessionRecordStore(directory, {
      records: [agentSessionRecordFixture(agentSessionLeaseFixture())]
    })
    const store = await openTestAgentSessionRecordStore(directory)
    await store.reconcileOnRestart({ probe: async () => ({ outcome: 'pid-absent' }), now: 90_000 })
    const evidence = store.getRecord(SESSION)?.lease.deathEvidence
    expect(evidence).toEqual({
      kind: 'pid-absent',
      detail: 'recorded pid absent on host',
      observedAt: 90_000,
      ownerFence: 7,
      lastProvenAliveAt: 30_000
    })
    const persisted = await readPersistedTestAgentSessionStore(directory)
    expect(persisted.records[SESSION]?.lease).toMatchObject({
      claimStatus: 'released',
      deathEvidence: evidence
    })

    // A parser fixture of committed SQLite rows, not a production profile downgrade writer.
    const readerDirectory = join(directory, 'older-record-reader')
    mkdirSync(readerDirectory, { mode: 0o700 })
    const readerPath = agentSessionStorePath(readerDirectory)
    writeFileSync(readerPath, await readPersistedTestAgentSessionStoreText(directory))
    const readerBytes = readFileSync(readerPath)

    const OldStore = baseline.AgentSessionRecordStore
    if (
      typeof OldStore !== 'function' ||
      !('open' in OldStore) ||
      typeof OldStore.open !== 'function'
    ) {
      throw new Error('Pinned release has no record store opener')
    }
    const old: unknown = await OldStore.open({ directory: readerDirectory, hostId: 'local' })
    if (
      typeof old !== 'object' ||
      old === null ||
      !('readOnly' in old) ||
      typeof old.readOnly !== 'boolean' ||
      !('isSessionUnreadable' in old) ||
      typeof old.isSessionUnreadable !== 'function' ||
      !('getRecord' in old) ||
      typeof old.getRecord !== 'function'
    ) {
      throw new Error('Pinned release has no record reader')
    }
    expect(old.readOnly).toBe(true)
    expect(old.isSessionUnreadable(SESSION)).toBe(false)
    const oldRecord: unknown = old.getRecord(SESSION)
    expect(oldRecord).toMatchObject({
      lease: { claimStatus: 'released', deathEvidence: evidence }
    })
    expect(readFileSync(readerPath)).toEqual(readerBytes)
    expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(readerBytes.toString())
  } finally {
    closeTestJournalHostDatabase(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})
