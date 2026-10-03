import { AGENT_JOURNAL_THREAD_SCOPE } from '../../shared/agent-session-journal-types'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HIVE_AGENT_METHODS,
  type AuthenticatedRuntimePrincipal
} from '../../shared/hive-agent-session-methods'
import { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { agentSessionStorePath } from '../runtime/agent-session-record-store-file'
import { AGENT_SESSION_STORE_SCHEMA_VERSION as VER } from '../runtime/agent-session-store-contract'
import { HiveAgentSessionHost } from './hive-agent-session-host'
import type { HiveAgentHostDependencies } from './hive-agent-session-dependencies'
import { HiveAgentFakeAdapter } from './hive-agent-fake-adapter'
import { createTrackedJournalOpener } from './agent-session-journal/journal-host-database-test-support'
import { journalDatabasePath } from './agent-session-journal/journal-host-database'
import type { AgentSessionJournal } from './agent-session-journal/journal-store'
import { recoverHiveAgentSessions } from './hive-agent-session-recovery'
import { hiveAgentSessionMethods } from '../runtime/rpc/methods/hive-agent-session'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { referenceExistingAgentBinding } from './hive-agent-existing-binding'
import { accountModelSelectionFixture as selection } from '../../shared/hive-ai-model-catalog.test-fixture'
import { textPackManifestFixture } from './hive-agent-text-pack.test-fixture'
import { agentJournalSubmissionKey } from '../../shared/agent-session-journal-item-key'

const NOW = 1_800_000_000_000
let root: string
let store: AgentSessionRecordStore
let deps: HiveAgentHostDependencies
let host: HiveAgentSessionHost
let principal: AuthenticatedRuntimePrincipal | null
const journals = createTrackedJournalOpener()
let opened: Map<string, AgentSessionJournal>
const operationId = () => `${NOW}-${randomUUID().replaceAll('-', '')}`
const sessionId = () => `ha-session:${randomUUID()}`
const resolve = () => principal
const call = (method: string, params: unknown) =>
  host.call(
    `hiveAgent.${method}`,
    method === 'submit'
      ? { modelSelection: selection, ...(params as Record<string, unknown>) }
      : params,
    resolve
  )
async function create(id = sessionId()) {
  expect(
    await call('create', { sessionId: id, operationId: operationId(), profileId: 'personal' })
  ).toMatchObject({ ok: true })
  return id
}

beforeEach(async () => {
  const artifactRoot = join(process.cwd(), 'logs/hive-agent-session-tests')
  await mkdir(artifactRoot, { recursive: true })
  root = await mkdtemp(join(artifactRoot, 'store-'))
  store = await AgentSessionRecordStore.open({ directory: root, hostId: 'host-1' })
  opened = new Map()
  principal = {
    kind: 'local',
    accountId: 'account-1',
    deviceId: 'device-1',
    runtimeRecordId: 'runtime-1',
    allowedMethods: Object.keys(HIVE_AGENT_METHODS),
    toolScopes: [],
    projectScope: 'folder-1',
    expiry: NOW + 1000,
    eligibilityRevision: 1
  }
  deps = {
    store,
    runtimeRecordId: 'runtime-1',
    adapter: new HiveAgentFakeAdapter(),
    readPack: () => ({ manifest: textPackManifestFixture(), assertCurrent: () => undefined }),
    resolveModel: async (command) => ({
      selection: { ...command },
      assertCurrent: () => undefined
    }),
    now: () => NOW,
    eligibilityRevision: () => 1,
    enabled: () => true,
    fenceFor: () => 1,
    journalFor: async (entry) => {
      const id = entry.aggregate.session.sessionId
      const existing = opened.get(id)
      if (existing) {
        return existing
      }
      const identity = {
        sessionId: id,
        workspaceId: entry.projectScope,
        hostId: 'host-1',
        agent: 'pi',
        providerHandle: { kind: 'opaque' as const, agent: 'pi', value: id }
      }
      const journal = await journals.open({
        identity,
        stateDirectory: root
      })
      opened.set(id, journal)
      return journal
    }
  }
  host = await HiveAgentSessionHost.open(deps)
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await host.close()
  await journals.closeAll()
  await rm(root, { recursive: true, force: true })
})

describe('HiveAgent durable text facade', () => {
  it.each(['completed', 'failed', 'unknown'] as const)(
    'reconstructs only successful pairs after restart: %s',
    async (outcome) => {
      deps.adapter = new HiveAgentFakeAdapter({
        events: [
          { sequence: 1, type: 'text', text: 'previous answer' },
          ...(outcome === 'unknown' ? [] : [{ sequence: 2, type: outcome }])
        ]
      })
      const id = await create()
      await call('submit', { sessionId: id, operationId: operationId(), text: 'previous question' })
      await host.drain()
      const journal = await deps.journalFor(store.hive.get(id)!)
      await journal.close()
      opened.delete(id)
      const { readHiveAgentConfirmedContext } = await import('./hive-agent-confirmed-context')
      const reopened = await deps.journalFor(store.hive.get(id)!)
      const expected =
        outcome === 'completed'
          ? [
              { role: 'user', text: 'previous question' },
              { role: 'assistant', text: 'previous answer' }
            ]
          : []
      expect(readHiveAgentConfirmedContext(reopened, 'next')).toEqual(expected)
      if (outcome !== 'unknown') {
        const run = vi.spyOn(deps.adapter, 'run')
        await call('submit', { sessionId: id, operationId: operationId(), text: 'next' })
        await host.drain()
        expect(run.mock.calls[0][0].history).toEqual(expected)
      } else {
        expect(await call('delete', { sessionId: id, operationId: operationId() })).toMatchObject({
          ok: true,
          value: { status: 'succeeded' }
        })
        expect(store.hive.get(id)?.deletionComplete).toBe(true)
      }
    }
  )
  it.each(['completed', 'failed'] as const)(
    'flushes a short buffered suffix before %s receipt',
    async (type) => {
      deps.adapter = new HiveAgentFakeAdapter({
        events: [
          { sequence: 1, type: 'text', text: 'first' },
          { sequence: 2, type: 'text', text: ' tail' },
          { sequence: 3, type }
        ]
      })
      const id = await create()
      const journal = await deps.journalFor(store.hive.get(id)!)
      const append = vi.spyOn(journal, 'appendItem')
      await call('submit', { sessionId: id, operationId: operationId(), text: 'flush' })
      await host.drain()
      const bodies = append.mock.calls.map((args) => args[1])
      expect(bodies.at(-2)).toMatchObject({ role: 'assistant', blocks: [{ text: 'first tail' }] })
      expect(bodies.at(-1)).toMatchObject({
        kind: 'turn',
        state: 'completed',
        outcome: type === 'completed' ? 'success' : 'failure',
        turnId: store.hive.get(id)!.aggregate.turn!.turnId,
        userItemId: agentJournalSubmissionKey(store.hive.get(id)!.aggregate.turn!.clientOperationId)
      })
      expect(store.hive.get(id)?.aggregate.generation?.state).toBe(type.toUpperCase())
    }
  )
  it('counts duplicate events against the generation budget and closes the iterator', async () => {
    let consumed = 0
    let closed = false
    const fake = new HiveAgentFakeAdapter()
    deps.adapter = {
      binding: (id) => fake.binding(id),
      run: async function* () {
        try {
          for (let index = 0; index < 10050; index += 1) {
            consumed += 1
            yield { sequence: 1, type: 'text', text: 'one' }
          }
          yield { sequence: 2, type: 'completed' }
        } finally {
          closed = true
        }
      }
    }
    const id = await create()
    const params = { sessionId: id, operationId: operationId(), text: 'duplicates' }
    await call('submit', params)
    await host.drain()
    expect(consumed).toBe(1001)
    expect(closed).toBe(true)
    expect(store.hive.get(id)?.aggregate.generation?.state).toBe('UNKNOWN')
    await call('submit', params)
    expect(consumed).toBe(1001)
  })
  it.each(['history', 'export'])('pages all older %s items without overlaps', async (method) => {
    const id = await create()
    const journal = await deps.journalFor(store.hive.get(id)!)
    for (let index = 0; index < 205; index += 1) {
      await journal.appendItem(
        { provider: 'orca', clientMessageId: `page-${index}` },
        { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: String(index) }] },
        { fence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
      )
    }
    const itemIds: string[] = []
    let cursor: { epoch: string; sequence: number } | undefined
    for (let page = 0; page < 4; page += 1) {
      const result = (await call(method, {
        sessionId: id,
        limit: 100,
        ...(cursor ? { cursor } : {})
      })) as {
        ok: boolean
        value: {
          page: {
            items: { itemId: string }[]
            hasOlder: boolean
            window: { nextCursor: { epoch: string; sequence: number } }
          }
        }
      }
      expect(result.ok).toBe(true)
      itemIds.push(...result.value.page.items.map((item) => item.itemId))
      if (!result.value.page.hasOlder) {
        break
      }
      cursor = result.value.page.window.nextCursor
    }
    expect(itemIds).toHaveLength(205)
    expect(new Set(itemIds).size).toBe(205)
    expect(await call(method, { sessionId: id, direction: 'after' })).toMatchObject({
      ok: false,
      error: { code: 'hive_agent_invalid_request' }
    })
  })
  it.each([99, 999])(
    'bounds %i text checkpoints and retains the complete final answer',
    async (chunks) => {
      deps.adapter = new HiveAgentFakeAdapter({
        events: [
          ...Array.from({ length: chunks }, (_, index) => ({
            sequence: index + 1,
            type: 'text' as const,
            text: 'x'.repeat(1024)
          })),
          { sequence: chunks + 1, type: 'completed' }
        ]
      })
      const id = await create()
      const journal = await deps.journalFor(store.hive.get(id)!)
      const append = vi.spyOn(journal, 'appendItem')
      await call('submit', {
        sessionId: id,
        operationId: operationId(),
        text: 'bounded checkpoints'
      })
      await host.drain()
      const bodies = append.mock.calls
        .map((args) => args[1])
        .filter((body) => body.kind === 'message' && body.role === 'assistant')
      const bytes = bodies.reduce((sum, body) => sum + Buffer.byteLength(JSON.stringify(body)), 0)
      expect(bytes).toBeLessThan(4 * chunks * 1024)
      const answer = journal
        .snapshot()
        .items.find((item) => item.body.kind === 'message' && item.body.role === 'assistant')
      expect(JSON.stringify(answer?.body)).toContain('x'.repeat(chunks * 1024))
      expect(store.hive.get(id)?.aggregate.generation?.state).toBe('COMPLETED')
      await journal.close()
      opened.delete(id)
      const reopened = await deps.journalFor(store.hive.get(id)!)
      expect(
        reopened.snapshot().items.find((item) => item.itemId === answer?.itemId)?.body
      ).toEqual(answer?.body)
      process.stdout.write(
        `P2 text checkpoints ${JSON.stringify({ chunks, outputBytes: chunks * 1024, bodyBytes: bytes, checkpoints: bodies.length })}\n`
      )
    }
  )
  it('refuses resubmission until a cancelled generation finishes cleanup', async () => {
    let finish!: () => void
    const waiting = new Promise<void>((resolveWait) => {
      finish = resolveWait
    })
    deps.adapter = new HiveAgentFakeAdapter({ wait: () => waiting })
    const id = await create()
    try {
      await call('submit', { sessionId: id, operationId: operationId(), text: 'A' })
      await call('cancel', {
        sessionId: id,
        operationId: operationId(),
        generationId: store.hive.get(id)!.aggregate.generation!.generationId
      })
      expect(
        await call('submit', { sessionId: id, operationId: operationId(), text: 'B' })
      ).toMatchObject({ ok: false })
    } finally {
      finish()
      await host.drain()
    }
    expect(
      await call('submit', { sessionId: id, operationId: operationId(), text: 'B' })
    ).toMatchObject({ ok: true })
    await host.drain()
    expect(store.hive.get(id)?.aggregate.generation?.state).toBe('COMPLETED')
  })
  it('bounds subscriptions and releases slots after disposal or revoked delivery', async () => {
    const id = await create()
    const disposers: (() => void)[] = []
    for (let index = 0; index < 32; index += 1) {
      disposers.push(await host.subscribe({ sessionId: id }, resolve, () => {}))
    }
    await expect(host.subscribe({ sessionId: id }, resolve, () => {})).rejects.toThrow(
      'hive_agent_capability_unavailable'
    )
    disposers.forEach((dispose) => dispose())
    let received = 0
    let subscriberPrincipal = principal
    const dispose = await host.subscribe(
      { sessionId: id },
      () => subscriberPrincipal,
      () => {
        received += 1
      }
    )
    subscriberPrincipal = { ...principal!, expiry: NOW }
    const prior = received
    await call('submit', { sessionId: id, operationId: operationId(), text: 'after revoke' })
    await host.drain()
    expect(received).toBe(prior)
    // All slots are available without manually disposing the revoked subscription.
    for (let index = 0; index < 32; index += 1) {
      disposers.push(await host.subscribe({ sessionId: id }, resolve, () => {}))
    }
    disposers.forEach((release) => release())
    dispose()
  })

  it('refuses a journal resolver pointing at a different product session', async () => {
    const first = await create()
    const second = await create()
    const wrong = await deps.journalFor(store.hive.get(first)!)
    deps.journalFor = async () => wrong
    expect(await call('history', { sessionId: second })).toEqual({
      ok: false,
      error: { code: 'hive_agent_forbidden' }
    })
  })

  it('caps output and never executes unknown tool-shaped events', async () => {
    deps.adapter = new HiveAgentFakeAdapter({
      events: [{ sequence: 1, type: 'text', text: 'x'.repeat(1024 * 1024 + 1) }]
    })
    const id = await create()
    expect(
      await call('submit', {
        sessionId: id,
        operationId: operationId(),
        text: 'tools',
        tools: ['shell']
      })
    ).toEqual({ ok: false, error: { code: 'hive_agent_invalid_request' } })
    await call('submit', { sessionId: id, operationId: operationId(), text: 'bounded' })
    await host.drain()
    expect(store.hive.get(id)?.aggregate.generation?.state).toBe('UNKNOWN')
    expect(JSON.stringify(opened.get(id)!.snapshot()).length).toBeLessThan(10000)
  })

  it('restarts an interrupted deletion without resurrecting content', async () => {
    const id = await create()
    await call('submit', {
      sessionId: id,
      operationId: operationId(),
      text: 'delete-secret-marker'
    })
    await host.drain()
    const journal = opened.get(id)!
    vi.spyOn(journal, 'purgeContent').mockRejectedValueOnce(new Error('crash before purge'))
    expect(await call('delete', { sessionId: id, operationId: operationId() })).toMatchObject({
      ok: false
    })
    const restartedStore = await AgentSessionRecordStore.open({ directory: root, hostId: 'host-1' })
    const restarted = await HiveAgentSessionHost.open({ ...deps, store: restartedStore })
    expect(restartedStore.hive.get(id)?.deletionComplete).toBe(true)
    expect(journal.snapshot().items).toEqual([])
    expect(
      (await readFile(journalDatabasePath(root))).includes(Buffer.from('delete-secret-marker'))
    ).toBe(false)
    await restarted.close()
  })

  it('registers the complete catalog on the existing RPC dispatcher with host-only identity', async () => {
    const methods = hiveAgentSessionMethods(host, () => principal)
    expect(methods.map((method) => method.name).sort()).toEqual(
      Object.keys(HIVE_AGENT_METHODS).sort()
    )
    const dispatcher = new RpcDispatcher({
      runtime: { getRuntimeId: () => 'runtime-1' } as OrcaRuntimeService,
      methods
    })
    const id = sessionId()
    expect(
      await dispatcher.dispatch({
        id: 'rpc-1',
        authToken: 'ignored-raw-token',
        method: 'hiveAgent.create',
        params: { sessionId: id, operationId: operationId(), profileId: 'personal' }
      })
    ).toMatchObject({ ok: true, result: { ok: true } })
    principal = null
    expect(
      await dispatcher.dispatch({
        id: 'rpc-2',
        authToken: 'forged',
        method: 'hiveAgent.submit',
        params: { fakeSecret: 'hidden' }
      })
    ).toMatchObject({ ok: true, result: { ok: false, error: { code: 'hive_agent_forbidden' } } })
  })

  it.each(['codex', 'claude'] as const)(
    'references %s without copying lease/history or enabling a fallback',
    async (provider) => {
      const handle =
        provider === 'codex'
          ? { provider, threadId: 'external-thread' }
          : { provider, sessionId: 'external-session', leafUuid: null }
      const binding = referenceExistingAgentBinding({
        sessionId: 'runtime_record_01',
        provider,
        providerHandleChain: [
          { linkId: 'link-1', handle, origin: 'adopted', mintedAtFence: 1, observedAt: NOW }
        ]
      })
      expect(binding).toMatchObject({
        providerKind: provider,
        runtimeRecordRef: 'runtime_record_01',
        capabilities: []
      })
      expect(binding).not.toHaveProperty('lease')
      const adapter = new HiveAgentFakeAdapter()
      deps.adapter = { binding: () => binding, run: adapter.run.bind(adapter) }
      const id = await create()
      expect(await call('binding', { sessionId: id })).toMatchObject({
        ok: true,
        value: { providerKind: provider }
      })
      expect(
        await call('submit', { sessionId: id, operationId: operationId(), text: 'no fallback' })
      ).toEqual({ ok: false, error: { code: 'hive_agent_capability_unavailable' } })
    }
  )

  it('retains only vault references and never serializes raw secrets from errors', async () => {
    const fake = new HiveAgentFakeAdapter()
    deps.adapter = {
      binding: (id) => ({ ...fake.binding(id), encryptedSecretRef: 'vault-ref-1' }),
      run: async function* () {
        yield await Promise.reject(new Error('fake-secret-value'))
      }
    }
    expect(
      await call('create', {
        sessionId: sessionId(),
        operationId: operationId(),
        profileId: 'personal'
      })
    ).toEqual({ ok: false, error: { code: 'hive_agent_forbidden' } })
    expect(store.hive.list()).toHaveLength(0)
    deps.hasSecretReference = (ref) => ref === 'vault-ref-1'
    const id = await create()
    await call('submit', { sessionId: id, operationId: operationId(), text: 'hello' })
    await host.drain()
    const read = JSON.stringify(await call('read', { sessionId: id }))
    expect(read).not.toContain('vault-ref-1')
    expect(read).not.toContain('fake-secret-value')
    expect(await readFile(agentSessionStorePath(root), 'utf8')).not.toContain('fake-secret-value')
    expect(JSON.stringify(opened.get(id)!.snapshot())).not.toContain('fake-secret-value')
  })

  it('waits for cancelled local work before purging its journal', async () => {
    const { promise: waiting, resolve: finish } = Promise.withResolvers<void>()
    deps.adapter = new HiveAgentFakeAdapter({ wait: () => waiting })
    const id = await create()
    await call('submit', { sessionId: id, operationId: operationId(), text: 'cancel me' })
    await call('cancel', {
      sessionId: id,
      operationId: operationId(),
      generationId: store.hive.get(id)!.aggregate.generation!.generationId
    })
    const deleting = call('delete', { sessionId: id, operationId: operationId() })
    finish()
    expect(await deleting).toMatchObject({ ok: true, value: { status: 'succeeded' } })
    expect(store.hive.get(id)?.deletionComplete).toBe(true)
  })

  it('exports paged history and purges only its owned journal with a replayable delete', async () => {
    const id = await create()
    await call('submit', { sessionId: id, operationId: operationId(), text: 'private-content-123' })
    await host.drain()
    expect(
      await call('export', {
        sessionId: id,
        cursor: { epoch: opened.get(id)!.epoch, sequence: 0 },
        direction: 'after',
        limit: 1
      })
    ).toMatchObject({ ok: true, value: { page: { hasNewer: true } } })
    const params = { sessionId: id, operationId: operationId() }
    expect(await call('delete', params)).toMatchObject({ ok: true, value: { status: 'succeeded' } })
    expect(opened.get(id)!.snapshot().items).toEqual([])
    expect(await call('delete', params)).toMatchObject({ ok: true, value: { replayed: true } })
    expect(await call('read', { sessionId: id })).toEqual({
      ok: false,
      error: { code: 'hive_agent_forbidden' }
    })
  })

  it('limits active generations to five and reclaims cancelled work', async () => {
    deps.adapter = new HiveAgentFakeAdapter({
      wait: (signal) =>
        new Promise((resolveWait) => {
          if (signal.aborted) {
            resolveWait()
          } else {
            signal.addEventListener('abort', () => resolveWait(), { once: true })
          }
        })
    })
    const ids = await Promise.all(Array.from({ length: 6 }, () => create()))
    for (const id of ids.slice(0, 5)) {
      expect(
        await call('submit', { sessionId: id, operationId: operationId(), text: 'wait' })
      ).toMatchObject({ ok: true })
    }
    expect(
      await call('submit', { sessionId: ids[5], operationId: operationId(), text: 'over limit' })
    ).toMatchObject({ ok: false })
    for (const id of ids.slice(0, 5)) {
      await call('cancel', {
        sessionId: id,
        operationId: operationId(),
        generationId: store.hive.get(id)!.aggregate.generation!.generationId
      })
    }
    await host.drain()
  })

  it('leaves memory and disk unchanged when atomic publication fails', async () => {
    const id = await create()
    const before = await readFile(agentSessionStorePath(root), 'utf8')
    const writes = await import('../durable-file-write')
    vi.spyOn(writes, 'renameDurable').mockRejectedValueOnce(new Error('injected before rename'))
    expect(
      await call('submit', { sessionId: id, operationId: operationId(), text: 'never-dispatch' })
    ).toMatchObject({ ok: false })
    expect(store.hive.get(id)?.aggregate.generation).toBeUndefined()
    expect(await readFile(agentSessionStorePath(root), 'utf8')).toBe(before)
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
  })

  it('recovers backup without allowing a lost operation to dispatch again', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const id = await create()
    const path = agentSessionStorePath(root)
    const beforeIntent = await readFile(path, 'utf8')
    const params = { sessionId: id, operationId: operationId(), text: 'once' }
    await call('submit', params)
    await host.drain()
    await writeFile(`${path}.bak`, beforeIntent)
    await writeFile(path, '{broken')
    const recovered = await AgentSessionRecordStore.open({ directory: root, hostId: 'host-1' })
    expect(recovered.recoveredFromBackup).toBe(true)
    expect(recovered.hive.get(id)).toMatchObject({
      accountId: 'account-1',
      deviceId: 'device-1',
      projectScope: 'folder-1',
      aggregate: { session: { sessionId: id } }
    })
    const restarted = await HiveAgentSessionHost.open({ ...deps, store: recovered })
    expect(
      await restarted.call('hiveAgent.submit', { ...params, modelSelection: selection }, resolve)
    ).toEqual({
      ok: false,
      error: { code: 'hive_agent_outcome_unknown' }
    })
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(1)
    await restarted.close()
  })

  it('creates, streams, settles, reloads history and replays without redispatch', async () => {
    const id = await create()
    const events: unknown[] = []
    const dispose = await host.subscribe({ sessionId: id }, resolve, (event) => events.push(event))
    const params = { sessionId: id, operationId: operationId(), text: 'hello' }
    expect(await call('submit', params)).toMatchObject({ ok: true, value: { status: 'pending' } })
    await host.drain()
    expect(await call('read', { sessionId: id })).toMatchObject({
      ok: true,
      value: { generation: { state: 'COMPLETED' } }
    })
    expect(await call('submit', params)).toMatchObject({
      ok: true,
      value: { replayed: true, status: 'succeeded' }
    })
    expect(await call('submit', { ...params, text: 'changed' })).toEqual({
      ok: false,
      error: { code: 'hive_agent_operation_conflict' }
    })
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(1)
    expect(events.length).toBeGreaterThan(1)
    dispose()
    const reopened = await AgentSessionRecordStore.open({ directory: root, hostId: 'host-1' })
    expect(reopened.hive.get(id)?.aggregate.generation?.state).toBe('COMPLETED')
    expect(await call('history', { sessionId: id })).toMatchObject({
      ok: true,
      value: { ok: true, page: { items: expect.any(Array) } }
    })
  })

  it('admits concurrent copies once and maintains a single ledger', async () => {
    const id = await create()
    const params = { sessionId: id, operationId: operationId(), text: 'once' }
    const results = await Promise.all([call('submit', params), call('submit', params)])
    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ ok: true })]))
    await host.drain()
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(1)
    expect(
      store.listOperationRows().filter((row) => row.operationId === params.operationId)
    ).toHaveLength(1)
    expect(store.listRecords()).toHaveLength(0)
  })

  it.each([
    { accountId: 'other' },
    { deviceId: 'other' },
    { runtimeRecordId: 'other' },
    { projectScope: 'other' },
    { allowedMethods: [] },
    { expiry: NOW },
    { eligibilityRevision: 0 },
    { relayConnectionId: 'forged' }
  ])('denies invalid authorization without provider dispatch: %j', async (patch) => {
    const id = await create()
    principal = { ...principal!, ...patch }
    expect(
      await call('submit', { sessionId: id, operationId: operationId(), text: 'never' })
    ).toEqual({ ok: false, error: { code: 'hive_agent_forbidden' } })
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
    expect(store.listOperationRows()).toHaveLength(1)
  })

  it('denies before payload schema errors and ignores raw bearer assertions', async () => {
    principal = null
    expect(await call('submit', { token: 'fake-secret', text: 123 })).toEqual({
      ok: false,
      error: { code: 'hive_agent_forbidden' }
    })
    expect(await host.call('hiveAgent.unknown', {}, resolve)).toEqual({
      ok: false,
      error: { code: 'hive_agent_forbidden' }
    })
  })

  it('cancels a waiting generation and rejects late or stale generation work', async () => {
    deps.adapter = new HiveAgentFakeAdapter({
      wait: (signal) =>
        new Promise((resolveWait) => {
          if (signal.aborted) {
            resolveWait()
          } else {
            signal.addEventListener('abort', () => resolveWait(), { once: true })
          }
        })
    })
    const id = await create()
    await call('submit', { sessionId: id, operationId: operationId(), text: 'wait' })
    const generationId = store.hive.get(id)!.aggregate.generation!.generationId
    expect(
      await call('cancel', { sessionId: id, operationId: operationId(), generationId })
    ).toMatchObject({ ok: true })
    await host.drain()
    expect(store.hive.get(id)?.aggregate.generation?.state).toBe('CANCELLED')
    expect(
      await call('cancel', {
        sessionId: id,
        operationId: operationId(),
        generationId: `ha-generation:${randomUUID()}`
      })
    ).toEqual({ ok: false, error: { code: 'hive_agent_stale_generation' } })
  })

  it.each([{ crash: true }, { events: [{ sequence: 2, type: 'completed' as const }] }])(
    'keeps crash/gap UNKNOWN without retry: %j',
    async (scenario) => {
      deps.adapter = new HiveAgentFakeAdapter(scenario)
      const id = await create()
      const params = { sessionId: id, operationId: operationId(), text: 'unknown' }
      await call('submit', params)
      await host.drain()
      expect(store.hive.get(id)?.aggregate.generation?.state).toBe('UNKNOWN')
      await call('submit', params)
      expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(1)
    }
  )

  it('deduplicates reordered old events and preserves final state', async () => {
    deps.adapter = new HiveAgentFakeAdapter({
      events: [
        { sequence: 1, type: 'text', text: 'one' },
        { sequence: 1, type: 'text', text: 'duplicate' },
        { sequence: 2, type: 'completed' },
        { sequence: 3, type: 'failed' }
      ]
    })
    const id = await create()
    await call('submit', { sessionId: id, operationId: operationId(), text: 'hello' })
    await host.drain()
    expect(store.hive.get(id)?.aggregate.generation?.state).toBe('COMPLETED')
    expect(JSON.stringify(opened.get(id)!.snapshot())).not.toContain('duplicate')
  })

  it('keeps history readable when execution is disabled and never falls back', async () => {
    const id = await create()
    deps.enabled = () => false
    expect(await call('read', { sessionId: id })).toMatchObject({ ok: true })
    expect(await call('submit', { sessionId: id, operationId: operationId(), text: 'no' })).toEqual(
      { ok: false, error: { code: 'hive_agent_capability_unavailable' } }
    )
  })

  it('migrates v2 atomically, preserving its backup and rejecting corrupted metadata', async () => {
    const path = agentSessionStorePath(root)
    const v2 = JSON.stringify({
      schemaVersion: 2,
      hostId: 'host-1',
      records: {},
      operations: {},
      retiredClaimKeys: [],
      unusableRecords: {}
    })
    await writeFile(path, v2)
    await AgentSessionRecordStore.open({ directory: root, hostId: 'host-1' })
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(VER)
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(v2)
  })

  it.each([
    ['recorded', 'COMPLETED'],
    ['kept-ledger', 'COMPLETED'],
    ['recorded-failure', 'FAILED'],
    ['success', 'COMPLETED'],
    ['failure', 'FAILED'],
    ['missing-outcome', 'UNKNOWN'],
    ['wrong-user', 'UNKNOWN'],
    ['wrong-turn', 'UNKNOWN'],
    ['unverifiable', 'UNKNOWN'],
    ['plain-text', 'UNKNOWN']
  ] as const)(
    'recovers only bound terminal evidence after reopening: %s',
    async (scenario, expected) => {
      if (scenario === 'recorded-failure') {
        deps.adapter = new HiveAgentFakeAdapter({ events: [{ sequence: 1, type: 'failed' }] })
      }
      const id = await create()
      await call('submit', { sessionId: id, operationId: operationId(), text: 'recover' })
      await host.drain()
      const current = store.hive.get(id)!.aggregate
      const journal = await deps.journalFor(store.hive.get(id)!)
      if (!['recorded', 'kept-ledger', 'recorded-failure'].includes(scenario)) {
        await journal.appendItem(
          { provider: 'orca', clientMessageId: `${current.generation!.generationId}:receipt` },
          scenario === 'plain-text'
            ? { kind: 'message', role: 'system', blocks: [{ type: 'text', text: 'COMPLETED' }] }
            : {
                kind: 'turn',
                turnId:
                  scenario === 'wrong-turn' ? `ha-turn:${randomUUID()}` : current.turn!.turnId,
                userItemId: agentJournalSubmissionKey(
                  scenario === 'wrong-user' ? operationId() : current.turn!.clientOperationId
                ),
                state: scenario === 'unverifiable' ? 'unverifiable' : 'completed',
                ...(scenario === 'missing-outcome'
                  ? {}
                  : {
                      outcome: scenario === 'failure' ? ('failure' as const) : ('success' as const)
                    })
              },
          { fence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
        )
      }
      await journal.close()
      opened.delete(id)
      const path = agentSessionStorePath(root)
      const raw = JSON.parse(await readFile(path, 'utf8'))
      const entry = raw.hiveSessions[id]
      entry.aggregate.generation.state = 'RUNNING'
      delete entry.aggregate.generation.finalReceiptRef
      entry.aggregate.turn.state = 'RUNNING'
      delete entry.aggregate.turn.finalizedAt
      if (scenario !== 'kept-ledger') {
        raw.operations = {}
      }
      await writeFile(path, JSON.stringify(raw))
      const restarted = await AgentSessionRecordStore.open({ directory: root, hostId: 'host-1' })
      await recoverHiveAgentSessions({ ...deps, store: restarted })
      expect(restarted.hive.get(id)?.aggregate.generation?.state).toBe(expected)
      expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(1)
    }
  )
})
