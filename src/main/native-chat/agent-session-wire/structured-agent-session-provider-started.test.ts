// A publish-first create proves nothing about the model until Claude answers startup. The record
// must never hold the catalog's default in the meantime: an owner handoff or a reopen would
// launch it as `--model` and silently move a user whose CLI default is not Sonnet.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentModelCatalogLiveListing } from '../agent-model-catalog/agent-model-catalog-store'
import type { AgentSessionStatusEvent } from '../../../shared/agent-session-wire'
import { ClaudeStructuredSessionAdapter } from '../../claude/claude-structured-session-adapter'
import {
  fakeClaude,
  PROVIDER_SESSION_ID
} from '../../claude/claude-structured-session-test-support'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { openTestAgentSessionRecordStore } from '../../runtime/agent-session-record-store-test-harness'
import { structuredClaudeLifecycleEvent } from '../../runtime/structured-claude-runtime-adapter'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  hostTestAttachParams,
  hostTestMessage,
  resetHostTestOperationIds
} from './structured-agent-session-host-test-data'
import {
  closeTestJournalHostDatabases,
  openTestJournalHostDatabase
} from '../agent-session-journal/journal-host-database-test-support'
import { createStructuredAgentSessionLogger } from './structured-agent-session-logger'
import { NO_STRUCTURED_AGENTS } from './structured-agent-session-adapter-router-test-support'
import { createTestParams } from './structured-agent-session-create-test-fixture'

const CALLER = { callerKey: 'client-1' }
const CLAUDE_MODELS = [
  { value: 'claude-sonnet', displayName: 'Sonnet' },
  { value: 'claude-opus-9', displayName: 'Opus 9' }
]
const LISTED = expect.arrayContaining([expect.objectContaining({ id: 'claude-opus-9' })])
const INIT_DELAY_MS = 40

let root: string
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost
let adapter: ClaudeStructuredSessionAdapter
let lifecycle: Promise<void>[]
let statuses: AgentSessionStatusEvent[]
let savedListings: { sessionId: string; listing: AgentModelCatalogLiveListing }[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-provider-started-'))
  resetHostTestOperationIds()
  lifecycle = []
  statuses = []
  savedListings = []
  // A CLI whose own default is not the catalog's: startup reports it through get_settings,
  // since system/init arrives only with the first command.
  const claude = fakeClaude({
    initDelayMs: INIT_DELAY_MS,
    initModel: 'claude-opus-9',
    settings: {
      applied: { model: 'claude-opus-9', effort: 'high', advisor: null, ultracode: false },
      effective: { model: 'claude-opus-9', effortLevel: 'high', env: {} },
      sources: {}
    },
    // Startup lists from initialize, and a chat's options read from list_models: the same rows.
    initModels: CLAUDE_MODELS,
    routes: { list_models: () => CLAUDE_MODELS }
  })
  adapter = new ClaudeStructuredSessionAdapter({
    resolveLaunch: async () => ({
      pathToClaudeCodeExecutable: 'claude',
      cliFlag: async () => 'supported' as const,
      options: {},
      cwd: root,
      claudeConfigDir: join(root, 'claude-home'),
      providerSessionId: PROVIDER_SESSION_ID,
      resumeLeafUuid: null,
      // A session that already minted its provider handle resumes it, as the real launch does.
      resumesTranscript: (store.getRecord(SESSION)?.providerHandleChain.length ?? 0) > 0,
      continuesChain: (store.getRecord(SESSION)?.providerHandleChain.length ?? 0) > 0
    }),
    // The runtime's own mapping, so this test drives the same lifecycle path production does.
    onEvent: (event) => {
      const mapped = structuredClaudeLifecycleEvent(event)
      if (mapped) {
        lifecycle.push(host.handleAdapterEvent(mapped))
      }
    },
    openConnection: claude.openConnection,
    readProcessStartTime: async () => 1_700_000_000_000,
    now: () => NOW
  })
  store = await openTestAgentSessionRecordStore(root)
  host = new StructuredAgentSessionHost({
    agents: NO_STRUCTURED_AGENTS,
    logger: createStructuredAgentSessionLogger(),
    store,
    // The production router is what declares create support; the bare adapter only knows locations.
    adapter: Object.assign(adapter, { supportsCreate: () => true }),
    journalDatabase: openTestJournalHostDatabase(root),
    claimKeyId: 'key-1',
    mintSpawnToken: () => 'spawn-a',
    modelCatalog: {
      snapshot: () => ({ origin: 'unknown' }),
      demand: async () => {},
      prepareSaved: async () => ({ origin: 'unknown' }),
      captureSource: () => () => true,
      retireContext: () => {},
      peek: () => null,
      read: async () => ({ origin: 'unknown' }),
      recordLiveListing: (sessionId, listing) => savedListings.push({ sessionId, listing }),
      prewarm: async () => {},
      stop: () => {},
      providerStarted: () => {}
    },
    now: () => NOW
  })
  host.subscribeStatus({ id: 'status-1', emit: (event) => statuses.push(event) })
})

afterEach(async () => {
  await adapter.closeAll()
  await host.flushAllStreamedEvents()
  closeTestJournalHostDatabases()
  await rm(root, { recursive: true, force: true })
})

function claudeParams(expectedRuntimeFence: number | null = null) {
  return hostTestAttachParams(expectedRuntimeFence, {
    provider: 'claude',
    agent: 'claude',
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: join(root, 'claude-home') },
    providerHandle: { kind: 'claude', sessionId: PROVIDER_SESSION_ID, leafUuid: null }
  })
}

function lastPhase(): string | undefined {
  const last = statuses.findLast((event) => event.type === 'status')
  return last?.type === 'status' ? last.session.hostExecutionPhase : undefined
}

describe('a publish-first Claude create whose init is slow', () => {
  it('keeps reported defaults out of durable user choices after startup', async () => {
    await expect(host.attach(CALLER, claudeParams())).resolves.toMatchObject({ ok: true })

    // Published, not yet answering: the record holds no model rather than a guessed one.
    expect(store.getRecord(SESSION)?.options?.model).toBeUndefined()
    expect(lastPhase()).toBe('starting')

    await vi.waitFor(() => expect(lastPhase()).toBe('ready'))
    await Promise.all(lifecycle)

    expect(store.getRecord(SESSION)?.options?.model).toBeUndefined()
    await vi.waitFor(async () =>
      expect(
        (
          await adapter.readOptions({
            sessionId: SESSION,
            fence: store.getRecord(SESSION)?.lease.runtimeFence ?? 0
          })
        ).current.model
      ).toBe('claude-opus-9')
    )
    expect(lastPhase()).toBe('ready')
  })

  it('keeps the saved model as intent while starting, then confirms what the child runs', async () => {
    const params = claudeParams()
    await expect(
      host.attach(CALLER, { ...params, options: { model: 'opus' } })
    ).resolves.toMatchObject({ ok: true })
    expect(store.getRecord(SESSION)?.options?.model).toBe('opus')

    await vi.waitFor(() => expect(lastPhase()).toBe('ready'))
    await Promise.all(lifecycle)

    expect(store.getRecord(SESSION)?.options?.model).toBe('opus')
    expect(lastPhase()).toBe('ready')
  })

  it('keeps the picked model across a resume whose new child starts on its own default', async () => {
    const params = claudeParams()
    await host.attach(CALLER, { ...params, options: { model: 'opus' } })
    await vi.waitFor(() => expect(lastPhase()).toBe('ready'))
    await Promise.all(lifecycle)
    await host.close(SESSION, 'evict')
    const releasedFence = store.getRecord(SESSION)?.lease.runtimeFence ?? 0

    // Starting the chat again resumes the session under a new fence.
    await expect(host.attach(CALLER, claudeParams(releasedFence))).resolves.toMatchObject({
      ok: true
    })
    expect(store.getRecord(SESSION)?.lease.runtimeFence).toBeGreaterThan(releasedFence)
    // The new child is launched with the saved pick, whatever its CLI default.
    expect(store.getRecord(SESSION)?.options?.model).toBe('opus')
    expect(lastPhase()).toBe('starting')

    await vi.waitFor(() => expect(lastPhase()).toBe('ready'))
    await Promise.all(lifecycle)

    expect(store.getRecord(SESSION)?.options?.model).toBe('opus')
    expect(lastPhase()).toBe('ready')
  })
  it('shows the observed model without treating startup as an account catalog probe', async () => {
    await host.attach(CALLER, claudeParams())
    await vi.waitFor(() => expect(lastPhase()).toBe('ready'))
    expect(
      (
        await adapter.readOptions({
          sessionId: SESSION,
          fence: store.getRecord(SESSION)?.lease.runtimeFence ?? 0
        })
      ).models
    ).toEqual(LISTED)
    expect(savedListings).toEqual([])
  })
  it('reports the configured default from a chat created with its first message and no pick', async () => {
    const first = { clientMessageId: 'opening', body: hostTestMessage('hello') }
    await expect(
      host.create(CALLER, createTestParams(first, claudeParams()), { firstMessage: first })
    ).resolves.toMatchObject({ ok: true })

    await vi.waitFor(() => expect(lastPhase()).toBe('ready'))
    await vi.waitFor(async () =>
      expect(
        (
          await adapter.readOptions({
            sessionId: SESSION,
            fence: store.getRecord(SESSION)?.lease.runtimeFence ?? 0
          })
        ).current.model
      ).toBe('claude-opus-9')
    )
    expect(
      (
        await adapter.readOptions({
          sessionId: SESSION,
          fence: store.getRecord(SESSION)?.lease.runtimeFence ?? 0
        })
      ).models
    ).toEqual(LISTED)
    expect(store.getRecord(SESSION)?.options?.model).toBeUndefined()
    expect(savedListings).toEqual([])
  })

  it('does not turn early settings readback into a persisted user model choice', async () => {
    // The attach is slow to prove the owner, so the child's readback lands before the host indexes it.
    const proveOwner = store.proveOwner.bind(store)
    store.proveOwner = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return proveOwner(input)
    }
    await expect(host.attach(CALLER, claudeParams())).resolves.toMatchObject({ ok: true })
    await vi.waitFor(() => expect(lastPhase()).toBe('ready'))
    await Promise.all(lifecycle)

    await vi.waitFor(async () =>
      expect(
        (
          await adapter.readOptions({
            sessionId: SESSION,
            fence: store.getRecord(SESSION)?.lease.runtimeFence ?? 0
          })
        ).current.model
      ).toBe('claude-opus-9')
    )
    expect(store.getRecord(SESSION)?.options?.model).toBeUndefined()
    expect(savedListings).toEqual([])
  })
})
