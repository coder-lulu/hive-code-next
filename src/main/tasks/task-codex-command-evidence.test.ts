import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowCommandEvidenceSchema } from '../../shared/task-workflow/workflow-command-evidence'
import {
  agentJournalItemKey,
  agentJournalSubmissionKey
} from '../../shared/agent-session-journal-item-key'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { createTaskCodexEvidence } from './task-codex-evidence'
import { collectTaskCodexCommandEvidence } from './task-codex-command-evidence'
import {
  commandEntry,
  commandEvidenceFixture,
  commandTurn,
  COMMAND_PROMPT,
  COMMAND_SESSION,
  COMMAND_TURN,
  commandTurnItemId
} from './task-codex-command-evidence.test-fixture'
import {
  createTrackedJournalOpener,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import { abandonStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host-test-abandon'
import {
  editPersistedTestAgentSessionStore,
  openTestAgentSessionRecordStore
} from '../runtime/agent-session-record-store-test-harness'
import { TASK_TEST_NOW } from './task-execution.test-fixture'

const mocks = vi.hoisted(() => ({ host: vi.fn() }))
vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: mocks.host
}))
const roots: string[] = []
const journals = createTrackedJournalOpener()
const hosts: StructuredAgentSessionHost[] = []
afterEach(async () => {
  vi.resetAllMocks()
  await Promise.all(hosts.splice(0).map(abandonStructuredAgentSessionHost))
  await journals.closeAll()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture(status: 'succeeded' | 'failed' = 'succeeded') {
  const f = await commandEvidenceFixture(status)
  roots.push(f.root)
  mocks.host.mockReturnValue(f.host)
  return f
}
function first<T>(values: T[]): T {
  const value = values[0]
  if (!value) {
    throw new Error('Missing test value')
  }
  return value
}

describe('original Task Codex command facts', () => {
  it('returns all original commands, producer and exact journal references without approving tests', async () => {
    const f = await fixture()
    f.snapshot.items.push(
      commandEntry('read-2', {
        command: 'cat src/a.ts',
        commandActions: [{ type: 'read', path: 'src/a.ts' }]
      })
    )
    const result = await collectTaskCodexCommandEvidence(f.record)
    expect(result).toMatchObject({
      kind: 'available',
      sessionId: COMMAND_SESSION,
      journalCursor: f.snapshot.cursor,
      turnItemId: commandTurnItemId,
      providerTurnId: COMMAND_TURN,
      turnOutcome: 'success',
      producer: { outcomeRef: f.record.result?.outcomeRef, status: 'succeeded' },
      commands: [
        { command: 'pnpm test', exitCode: 0, callId: 'command-1', revision: 2 },
        { command: 'cat src/a.ts', exitCode: 0 }
      ]
    })
    expect(WorkflowCommandEvidenceSchema.safeParse(result).success).toBe(true)
    expect(result).not.toHaveProperty('decision')
    expect(f.host.flushStreamedEvents).toHaveBeenCalledWith(COMMAND_SESSION)
  })
  it('retains nonzero commands and the failed original outcome', async () => {
    const f = await fixture('failed')
    const turn = first(f.snapshot.items)
    if (turn.body.kind !== 'turn') {
      throw new Error('Missing turn')
    }
    turn.body.outcome = 'failure'
    f.snapshot.items.push(commandEntry('failed-2', { command: 'pnpm test broken', exitCode: 2 }))
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'available',
      turnOutcome: 'failure',
      producer: { status: 'failed' },
      commands: [{ exitCode: 0 }, { state: 'failed', exitCode: 2 }]
    })
  })
  it('keeps echo and an empty command list as facts without inventing semantic success', async () => {
    const f = await fixture()
    f.snapshot.items = [commandTurn(), commandEntry('echo', { command: 'echo PASS' })]
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'available',
      commands: [{ command: 'echo PASS' }]
    })
    f.snapshot.items = [commandTurn()]
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'available',
      commands: []
    })
  })
  it('excludes child, thread and foreign-turn commands and MCP pretending to be shell', async () => {
    const f = await fixture()
    f.snapshot.items.push(
      commandEntry('child', {}, { agentId: 'child-1' }),
      commandEntry('thread', {}, { turnScope: { kind: 'thread' } }),
      commandEntry('foreign', {}, { turnScope: { kind: 'turn', turnItemId: 'foreign-turn' } })
    )
    const mcp = commandEntry('mcp')
    if (mcp.body.kind !== 'tool-call') {
      throw new Error('Missing tool')
    }
    mcp.body.mcpIdentity = { server: 'fake', tool: 'shell' }
    f.snapshot.items.push(mcp)
    const result = await collectTaskCodexCommandEvidence(f.record)
    expect(result).toMatchObject({ kind: 'available', commands: [{ callId: 'command-1' }] })
    if (result.kind === 'available') {
      expect(result.commands).toHaveLength(1)
    }
  })
  it.each([undefined, null, 1.5, Infinity, Number.NaN])(
    'refuses a command with absent or invalid exit %s',
    async (exitCode) => {
      const f = await fixture()
      f.snapshot.items = [commandTurn(), commandEntry('missing-exit', { exitCode })]
      expect(await collectTaskCodexCommandEvidence(f.record)).toEqual({
        kind: 'unavailable',
        reason: 'command_metadata_unavailable'
      })
    }
  )
  it('refuses truncated command input and absent cwd rather than reading the clipped head', async () => {
    const f = await fixture()
    f.snapshot.items = [commandTurn(), commandEntry('clipped', { command: 'x'.repeat(16384) })]
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'unavailable',
      reason: 'command_metadata_unavailable'
    })
    f.snapshot.items = [commandTurn(), commandEntry('no-cwd', { cwd: null })]
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({ kind: 'unavailable' })
  })
  it('refuses wrong cwd, ambiguous serialized input and completed nonzero state', async () => {
    const f = await fixture()
    f.snapshot.items = [commandTurn(), commandEntry('foreign-cwd', { cwd: '/outputs' })]
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({ kind: 'unavailable' })
    const tool = commandEntry()
    if (tool.body.kind !== 'tool-call') {
      throw new Error('Missing tool')
    }
    tool.body.input = { command: 'pnpm test', cwd: '/workspace', extra: BigInt(1) }
    f.snapshot.items = [commandTurn(), tool]
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({ kind: 'unavailable' })
    tool.body.input = { command: 'pnpm test', cwd: '/workspace' }
    tool.body.state = 'completed'
    tool.body.exitCode = 1
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({ kind: 'unavailable' })
  })
  it.each([null, [], { cwd: '/workspace' }])(
    'refuses a recognized command with missing input %j',
    async (input) => {
      const f = await fixture()
      const entry = commandEntry()
      if (entry.body.kind !== 'tool-call') {
        throw new Error('Missing tool')
      }
      entry.body.input = input
      f.snapshot.items = [commandTurn(), entry]
      expect(await collectTaskCodexCommandEvidence(f.record)).toEqual({
        kind: 'unavailable',
        reason: 'command_metadata_unavailable'
      })
    }
  )
  it('rejects provider assistant identity and duplicate accepted submissions', async () => {
    const f = await fixture()
    first(f.snapshot.submissions).providerItemId = agentJournalItemKey({
      provider: 'codex',
      threadId: 'thread-command-evidence',
      turnId: COMMAND_TURN,
      ordinal: 1
    })
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'unavailable',
      reason: 'journal_binding_unavailable'
    })
    first(f.snapshot.submissions).providerItemId = agentJournalItemKey({
      provider: 'codex',
      threadId: 'thread-command-evidence',
      turnId: COMMAND_TURN,
      ordinal: 0
    })
    f.snapshot.submissions.push({ ...first(f.snapshot.submissions) })
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'unavailable',
      reason: 'journal_binding_unavailable'
    })
  })
  it.each(['provider', 'workspace', 'host', 'session', 'thread'])(
    'rejects foreign original session %s',
    async (fault) => {
      const f = await fixture()
      if (fault === 'provider') {
        f.session.provider = 'claude'
      }
      if (fault === 'workspace') {
        f.session.location.workspaceId = 'foreign-workspace'
      }
      if (fault === 'host') {
        f.session.location.wslDistro = 'foreign-distro'
      }
      if (fault === 'session') {
        f.session.sessionId = 'foreign-session'
      }
      if (fault === 'thread') {
        first(f.session.providerHandleChain).handle = {
          provider: 'codex',
          threadId: 'foreign-thread'
        }
      }
      expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
        kind: 'unavailable',
        reason: 'journal_binding_unavailable'
      })
    }
  )
  it.each(['prompt', 'duplicate', 'turn-id', 'provider-id', 'snapshot-session', 'session-source'])(
    'refuses an ambiguous original %s binding',
    async (fault) => {
      const f = await fixture()
      const turn = first(f.snapshot.items)
      if (turn.body.kind !== 'turn') {
        throw new Error('Missing turn')
      }
      if (fault === 'prompt') {
        turn.body.userItemId = agentJournalSubmissionKey('other-prompt')
      }
      if (fault === 'duplicate') {
        f.snapshot.items.push({ ...commandTurn(), itemId: 'other-turn' })
      }
      if (fault === 'turn-id') {
        turn.body.turnId = 'foreign-turn'
      }
      if (fault === 'provider-id') {
        first(f.snapshot.submissions).providerItemId = 'foreign-provider-item'
      }
      if (fault === 'snapshot-session') {
        f.snapshot.sessionId = 'foreign-session'
      }
      if (fault === 'session-source' && f.session.taskSource) {
        f.session.taskSource.executionId = 'foreign-execution'
      }
      expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
        kind: 'unavailable',
        reason: 'journal_binding_unavailable'
      })
    }
  )
  it.each(['pending', 'rejected', 'unknown'] as const)(
    'refuses original prompt dispatch %s',
    async (dispatchState) => {
      const f = await fixture()
      first(f.snapshot.submissions).dispatchState = dispatchState
      expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
        kind: 'unavailable',
        reason: 'journal_binding_unavailable'
      })
    }
  )
  it('requires stopped settlement before touching the Host journal', async () => {
    const f = await fixture()
    expect(await collectTaskCodexCommandEvidence(f.beforeStop)).toEqual({
      kind: 'unavailable',
      reason: 'record_not_stopped'
    })
    const result = f.record.result
    if (!result) {
      throw new Error('Missing result')
    }
    Object.assign(result.stopProof, { writersFenced: false })
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'unavailable',
      reason: 'record_not_stopped'
    })
    expect(f.host.journalSnapshot).not.toHaveBeenCalled()
  })
  it.each(['managedToolsSettled', 'evidenceKind', 'cancelled', 'record-tuple'])(
    'rejects invalid original stop/producer %s',
    async (fault) => {
      const f = await fixture()
      if (!f.record.result) {
        throw new Error('Missing result')
      }
      if (fault === 'managedToolsSettled') {
        Object.assign(f.record.result.stopProof, { managedToolsSettled: false })
      }
      if (fault === 'evidenceKind') {
        Object.assign(f.record.result.stopProof, { evidenceKind: 'not_started' })
      }
      if (fault === 'cancelled') {
        f.record.cancellationKey = 'cancel:fixture'
      }
      if (fault === 'record-tuple') {
        f.record.command.executionId = 'foreign-execution'
      }
      expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
        kind: 'unavailable',
        reason: 'record_not_stopped'
      })
      expect(f.host.journalSnapshot).not.toHaveBeenCalled()
    }
  )
  it.each(['root-tool', 'child-tool', 'other-turn'])(
    'refuses any live %s before treating the journal as settled',
    async (scope) => {
      const f = await fixture()
      f.snapshot.items.push(
        scope === 'other-turn'
          ? {
              ...commandTurn(),
              body: {
                kind: 'turn',
                turnId: 'live-turn',
                state: 'running',
                startedAt: TASK_TEST_NOW
              }
            }
          : commandEntry(
              'running',
              { status: 'inProgress' },
              scope === 'child-tool' ? { agentId: 'child' } : {}
            )
      )
      expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
        kind: 'unavailable',
        reason: 'journal_binding_unavailable'
      })
    }
  )
  it('refuses failed drain or unreadable journals and never falls back to provider history', async () => {
    const f = await fixture()
    f.host.flushStreamedEvents.mockRejectedValueOnce(new Error('sink failure'))
    expect(await collectTaskCodexCommandEvidence(f.record)).toEqual({
      kind: 'unavailable',
      reason: 'journal_unavailable'
    })
    expect(f.host.journalSnapshot).not.toHaveBeenCalled()
    f.host.journalSnapshot.mockRejectedValueOnce(new Error('journal unreadable'))
    expect(await collectTaskCodexCommandEvidence(f.record)).toEqual({
      kind: 'unavailable',
      reason: 'journal_unavailable'
    })
  })
  it('enforces 128 commands and preserves bounded output instead of truncating facts', async () => {
    const f = await fixture()
    f.snapshot.items = [
      commandTurn(),
      ...Array.from({ length: 128 }, (_, i) =>
        commandEntry(`command-${i}`, { aggregatedOutput: 'x'.repeat(20000) })
      )
    ]
    const result = await collectTaskCodexCommandEvidence(f.record)
    expect(result.kind).toBe('available')
    if (result.kind === 'available') {
      expect(result.commands).toHaveLength(128)
      expect(first(result.commands).output).toMatchObject({ truncated: true, byteLength: 20000 })
      expect(Buffer.byteLength(first(result.commands).output?.head ?? '')).toBe(16384)
    }
    f.snapshot.items.push(commandEntry('one-too-many'))
    expect(await collectTaskCodexCommandEvidence(f.record)).toEqual({
      kind: 'unavailable',
      reason: 'command_limit_exceeded'
    })
  })
  it('rejects oversized raw output, duplicate call refs and forged command item keys', async () => {
    const f = await fixture()
    const tool = commandEntry('tampered')
    if (tool.body.kind !== 'tool-call' || !tool.body.output) {
      throw new Error('Missing output')
    }
    tool.body.output.head = 'x'.repeat(16385)
    f.snapshot.items.push(tool)
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'unavailable',
      reason: 'command_metadata_unavailable'
    })
    f.snapshot.items = [commandTurn(), commandEntry(), commandEntry()]
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'unavailable',
      reason: 'command_metadata_unavailable'
    })
    f.snapshot.items = [commandTurn(), commandEntry('forged', {}, { itemId: 'model-claimed-key' })]
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'unavailable',
      reason: 'command_metadata_unavailable'
    })
  })
  it('keeps original collect behavior while sharing unique prompt/turn binding', async () => {
    const f = await fixture()
    const evidence = createTaskCodexEvidence(f.artifacts)
    expect((await evidence.collect(f.beforeStop))?.status).toBe('succeeded')
    expect(await evidence.collectCommands(f.record)).toMatchObject({ kind: 'available' })
    f.snapshot.items.push({ ...commandTurn(), itemId: 'duplicate' })
    expect(await evidence.collect(f.beforeStop)).toBeNull()
    expect(await evidence.collectCommands(f.record)).toMatchObject({ kind: 'unavailable' })
  })
  it('reads the real persisted journal after its writer closes using an at-rest opener', async () => {
    const f = await fixture()
    const identity = {
      sessionId: COMMAND_SESSION,
      workspaceId: f.record.workspace.workspaceId,
      hostId: 'local',
      agent: 'codex',
      providerHandle: { kind: 'codex', threadId: 'thread-command-evidence' }
    } as const
    const journal = await journals.open({ identity, stateDirectory: f.root })
    await journal.appendSubmission({
      clientMessageId: COMMAND_PROMPT,
      payloadFingerprint: 'a'.repeat(64),
      body: { kind: 'message', role: 'user', blocks: [] },
      fence: 1
    })
    await journal.resolveDispatch({
      clientMessageId: COMMAND_PROMPT,
      state: 'accepted',
      fence: 1,
      providerIdentity: {
        provider: 'codex',
        threadId: 'thread-command-evidence',
        turnId: COMMAND_TURN,
        ordinal: 0
      }
    })
    await journal.appendItem(
      {
        provider: 'legacy',
        agent: 'codex',
        sessionId: COMMAND_SESSION,
        recordId: `turn-lifecycle:${COMMAND_TURN}`
      },
      commandTurn().body,
      { fence: 1, turnScope: { kind: 'thread' } }
    )
    await journal.appendItem(
      { provider: 'orca', clientMessageId: 'codex-item:thread-command-evidence:command-1' },
      commandEntry().body,
      { fence: 1, turnScope: { kind: 'turn', turnItemId: commandTurnItemId } }
    )
    await journal.close()
    const session: AgentSessionRecord = {
      ...f.session,
      schemaVersion: 2,
      accountHome: { variable: 'CODEX_HOME', path: f.root },
      lease: {
        sessionId: COMMAND_SESSION,
        runtimeKind: 'native',
        runtimeFence: 1,
        handoffStage: null,
        provenHandleLinkId: null,
        ownerProcess: null,
        reservedSpawnToken: null,
        leaseDeadlineAt: 0,
        lastRenewedAt: 0,
        handoffOperationId: null,
        journalCheckpoint: null,
        claimKeyId: 'key-command-fixture',
        claimStatus: 'released',
        unreconciled: false,
        deathEvidence: null
      },
      createdAt: TASK_TEST_NOW,
      updatedAt: TASK_TEST_NOW
    }
    await editPersistedTestAgentSessionStore(f.root, (persisted) => {
      persisted.records[COMMAND_SESSION] = session
    })
    const acquire = vi.fn(async () => {
      throw new Error('Provider startup is forbidden in this fixture')
    })
    const dispatch = vi.fn(async () => {
      throw new Error('Provider dispatch is forbidden in this fixture')
    })
    const realHostOptions = {
      store: await openTestAgentSessionRecordStore(f.root),
      journalDatabase: openTestJournalHostDatabase(f.root),
      claimKeyId: 'key-command-fixture',
      adapter: {
        acquire,
        dispatch,
        cancelTurn: async () => ({ cancelled: false }),
        answerPrompt: async () => undefined,
        setOption: async () => undefined
      },
      now: () => TASK_TEST_NOW,
      idleSweep: { intervalMs: 60000, idleMs: 60000 }
    }
    const realHost = new StructuredAgentSessionHost(realHostOptions)
    hosts.push(realHost)
    mocks.host.mockReturnValue(realHost)
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'available',
      commands: [{ exitCode: 0 }]
    })
    await abandonStructuredAgentSessionHost(realHost)
    hosts.pop()
    const reopenedHost = new StructuredAgentSessionHost({
      ...realHostOptions,
      store: await openTestAgentSessionRecordStore(f.root)
    })
    hosts.push(reopenedHost)
    mocks.host.mockReturnValue(reopenedHost)
    expect(await collectTaskCodexCommandEvidence(f.record)).toMatchObject({
      kind: 'available',
      commands: [{ exitCode: 0 }]
    })
    expect(acquire).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('strict shared command facts contract', () => {
  it('rejects extra authority claims, invalid exit metadata and oversized UTF8 facts', async () => {
    const f = await fixture()
    const facts = await collectTaskCodexCommandEvidence(f.record)
    if (facts.kind !== 'available') {
      throw new Error('Missing command facts')
    }
    expect(WorkflowCommandEvidenceSchema.safeParse({ ...facts, approved: true }).success).toBe(
      false
    )
    expect(
      WorkflowCommandEvidenceSchema.safeParse({
        ...facts,
        commands: [{ ...first(facts.commands), exitCode: 1.5 }]
      }).success
    ).toBe(false)
    expect(
      WorkflowCommandEvidenceSchema.safeParse({
        ...facts,
        commands: [{ ...first(facts.commands), command: '界'.repeat(5500) }]
      }).success
    ).toBe(false)
    expect(
      WorkflowCommandEvidenceSchema.safeParse({ kind: 'unavailable', reason: 'approved' }).success
    ).toBe(false)
  })
})
