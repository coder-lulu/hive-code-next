import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStoreText
} from '../runtime/agent-session-record-store-test-harness'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  HIVE_AGENT_METHODS,
  type AuthenticatedRuntimePrincipal
} from '../../shared/hive-agent-session-methods'
import {
  accountModelCatalogFixture as catalog,
  accountModelSelectionFixture as selection
} from '../../shared/hive-ai-model-catalog.test-fixture'
import { HiveAiModelReader } from '../hive-runtime-cloud/hive-ai-model-reader'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { HiveAgentSessionHost } from './hive-agent-session-host'
import type { HiveAgentHostDependencies } from './hive-agent-session-dependencies'
import type { HiveAiCatalogClient } from '../hive-runtime-cloud/hive-ai-catalog-client'
import { HiveAgentFakeAdapter } from './hive-agent-fake-adapter'
import { createTrackedJournalOpener } from './agent-session-journal/journal-host-database-test-support'
import { textPackManifestFixture } from './hive-agent-text-pack.test-fixture'
import type { HiveAgentTextPackManifest } from '../../shared/hive-agent-text-pack'

const NOW = 1_800_000_000_000
const operationId = () => `${NOW}-${randomUUID().replaceAll('-', '')}`
const modelB = { ...selection, modelId: 'model-b', protocol: 'RESPONSES' as const }
const journals = createTrackedJournalOpener()
let root: string
let deps: HiveAgentHostDependencies
let host: HiveAgentSessionHost
let reader: HiveAiModelReader
let auth: HiveRuntimeCloudAuthorization | null
let principal: AuthenticatedRuntimePrincipal
let client: { catalog: Mock<HiveAiCatalogClient['catalog']> }
let packManifest: HiveAgentTextPackManifest
let packCurrent: boolean
const resolve = () => principal
const submit = (id: string, patch: Record<string, unknown> = {}) =>
  host.call(
    'hiveAgent.submit',
    {
      sessionId: id,
      operationId: operationId(),
      text: 'hello',
      modelSelection: { ...selection },
      ...patch
    },
    resolve
  )
async function create() {
  const id = `ha-session:${randomUUID()}`
  expect(
    await host.call(
      'hiveAgent.create',
      { sessionId: id, operationId: operationId(), profileId: 'personal' },
      resolve
    )
  ).toMatchObject({ ok: true })
  return id
}
beforeEach(async () => {
  packManifest = textPackManifestFixture()
  packCurrent = true
  const artifactRoot = join(process.cwd(), 'logs/hive-agent-generation-model-tests')
  await mkdir(artifactRoot, { recursive: true })
  root = await mkdtemp(join(artifactRoot, 'store-'))
  auth = {
    accountId: 'account-1',
    authorityId: 'authority-1',
    sessionGeneration: 1,
    accessToken: 'private-fixture-token',
    sessionExpiresAt: Date.now() + 60_000
  }
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
  client = { catalog: vi.fn<HiveAiCatalogClient['catalog']>().mockResolvedValue(catalog) }
  reader = new HiveAiModelReader(
    {
      getRuntimeCloudAuthorization: () => auth,
      subscribeRuntimeCloudAuthorization: () => () => undefined
    },
    () => ({
      configured: true,
      config: {
        apiBaseUrl: 'https://cloud.example.test',
        userLoginUrl: '',
        identityIssuer: '',
        clientId: '',
        scope: ''
      }
    }),
    () => client
  )
  const store = await openTestAgentSessionRecordStore(root, { hostId: 'host-1' })
  const opened = new Map<string, Awaited<ReturnType<typeof journals.open>>>()
  deps = {
    store,
    runtimeRecordId: 'runtime-1',
    adapter: new HiveAgentFakeAdapter(),
    readPack: () => ({
      manifest: packManifest,
      assertCurrent: () => {
        if (!packCurrent) {
          throw new Error('private-Pack-source-diagnostics')
        }
      }
    }),
    now: () => NOW,
    eligibilityRevision: () => 1,
    enabled: () => true,
    fenceFor: () => 1,
    resolveModel: (command, caller) => reader.resolveForGeneration(command, caller.accountId),
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
        providerHandle: { transport: 'managed-pi', agent: 'pi', nativeId: id }
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
  await host.close()
  await journals.closeAll()
  await rm(root, { recursive: true, force: true })
})
describe('P2 Pack admission and durable execution binding', () => {
  it.each(['account', 'expiry', 'closed'])(
    'rechecks %s when the transaction queue returns an already-recorded receipt',
    async (boundary) => {
      const id = await create()
      const operation = operationId()
      const commit = deps.store.hive.commit
      let release!: () => void
      const waiting = new Promise<void>((accept) => {
        release = accept
      })
      const queued = vi.spyOn(deps.store.hive, 'commit').mockImplementationOnce(async (input) => {
        await waiting
        return commit(input)
      })
      const late = submit(id, { operationId: operation })
      try {
        await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce())
        expect(await submit(id, { operationId: operation })).toMatchObject({ ok: true })
        await host.drain()
        const before = deps.store.hive.get(id)
        if (boundary === 'closed') {
          await host.close()
        } else {
          principal = {
            ...principal,
            ...(boundary === 'account' ? { accountId: 'other-account' } : { expiry: NOW })
          }
        }
        deps.readPack = undefined
        release()
        expect(await late).toEqual({
          ok: false,
          error: {
            code:
              boundary === 'closed' ? 'hive_agent_capability_unavailable' : 'hive_agent_forbidden'
          }
        })
        expect(deps.store.hive.get(id)).toEqual(before)
        expect(deps.store.listOperationRows()).toHaveLength(2)
        expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(1)
      } finally {
        release()
        await late
      }
    }
  )
  it.each(['manifest', 'executionBinding'])(
    'refuses caller-supplied %s before reading the trusted source',
    async (field) => {
      const id = await create()
      const readPack = vi.spyOn(deps, 'readPack')
      expect(await submit(id, { [field]: { packRevision: 'c'.repeat(64) } })).toEqual({
        ok: false,
        error: { code: 'hive_agent_invalid_request' }
      })
      expect(readPack).not.toHaveBeenCalled()
      expect(client.catalog).not.toHaveBeenCalled()
      expect(deps.store.listOperationRows()).toHaveLength(1)
      expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
    }
  )
  it.each(['missing', 'empty', 'malformed', 'revoked'])(
    'refuses %s Pack sources before model lookup or mutation',
    async (failure) => {
      const id = await create()
      const before = await readPersistedTestAgentSessionStoreText(root, { hostId: 'host-1' })
      if (failure === 'missing') {
        deps.readPack = undefined
      }
      if (failure === 'empty') {
        deps.readPack = () => null
      }
      if (failure === 'malformed') {
        deps.readPack = () => ({
          manifest: { apiKey: 'private-credential' },
          assertCurrent: () => undefined
        })
      }
      if (failure === 'revoked') {
        packCurrent = false
      }
      expect(await submit(id)).toEqual({
        ok: false,
        error: { code: 'hive_agent_pack_unavailable' }
      })
      expect(client.catalog).not.toHaveBeenCalled()
      expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
      expect(deps.store.listOperationRows()).toHaveLength(1)
      expect(await readPersistedTestAgentSessionStoreText(root, { hostId: 'host-1' })).toBe(before)
    }
  )

  it('persists and freezes exact execution metadata; only a later generation takes a new Pack', async () => {
    const fake = deps.adapter as HiveAgentFakeAdapter
    const run = vi.spyOn(fake, 'run')
    const id = await create()
    expect(await submit(id)).toMatchObject({ ok: true })
    await host.drain()
    const original = deps.store.hive.get(id)!.aggregate.generation!
    const supplied = run.mock.calls[0]![0].executionBinding
    expect(supplied).toEqual({
      schemaVersion: 1,
      packRevision: 'b'.repeat(64),
      profileId: 'personal',
      protocol: 'CHAT_COMPLETIONS',
      toolPolicy: 'empty',
      maxInputTokens: 16_000,
      maxOutputTokens: 2_000
    })
    expect(original.executionBinding).toEqual(supplied)
    expect(Object.isFrozen(supplied)).toBe(true)
    expect(Reflect.set(supplied, 'maxOutputTokens', 9999)).toBe(false)
    const reloaded = await openTestAgentSessionRecordStore(root, { hostId: 'host-1' })
    expect(reloaded.hive.get(id)?.aggregate.generation?.executionBinding).toEqual(supplied)
    packManifest = { ...packManifest, packRevision: 'c'.repeat(64) }
    packManifest.profiles[0]!.maxInputTokens = 500
    packManifest.profiles[0]!.maxOutputTokens = 300
    expect(await submit(id, { modelSelection: modelB })).toMatchObject({ ok: true })
    await host.drain()
    expect(run.mock.calls[1]![0].executionBinding).toMatchObject({
      packRevision: 'c'.repeat(64),
      protocol: 'RESPONSES',
      maxInputTokens: 500,
      maxOutputTokens: 300
    })
    expect(deps.store.hive.get(id)?.aggregate.generation?.generationId).not.toBe(
      original.generationId
    )
    expect(supplied.packRevision).toBe('b'.repeat(64))
  })

  it.each(['revision', 'same-revision-content', 'source', 'revoked'])(
    'rechecks %s changes after delayed lookup before commit',
    async (change) => {
      const id = await create()
      const before = await readPersistedTestAgentSessionStoreText(root, { hostId: 'host-1' })
      let finish!: () => void
      const waiting = new Promise<void>((release) => {
        finish = release
      })
      const resolveModel = vi.fn<NonNullable<HiveAgentHostDependencies['resolveModel']>>(
        async (command) => {
          await waiting
          return { selection: { ...command }, assertCurrent: () => undefined }
        }
      )
      deps.resolveModel = resolveModel
      const pending = submit(id)
      try {
        await vi.waitFor(() => expect(resolveModel).toHaveBeenCalledOnce())
        if (change === 'revision') {
          packManifest.packRevision = 'c'.repeat(64)
        }
        if (change === 'same-revision-content') {
          packManifest.profiles[0]!.maxOutputTokens = 10
        }
        if (change === 'source') {
          deps.readPack = () => ({ manifest: packManifest, assertCurrent: () => undefined })
        }
        if (change === 'revoked') {
          packCurrent = false
        }
        finish()
        expect(await pending).toEqual({ ok: false, error: { code: 'hive_agent_pack_unavailable' } })
        expect(deps.store.hive.get(id)?.aggregate.generation).toBeUndefined()
        expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
        expect(deps.store.listOperationRows()).toHaveLength(1)
        expect(await readPersistedTestAgentSessionStoreText(root, { hostId: 'host-1' })).toBe(
          before
        )
      } finally {
        finish()
        await pending
      }
    }
  )

  it('checks Pack scope inside the existing transaction before writing', async () => {
    const id = await create()
    const before = await readPersistedTestAgentSessionStoreText(root, { hostId: 'host-1' })
    const commit = deps.store.hive.commit
    vi.spyOn(deps.store.hive, 'commit').mockImplementation(async (input) => {
      packCurrent = false
      return commit(input)
    })
    expect(await submit(id)).toEqual({ ok: false, error: { code: 'hive_agent_pack_unavailable' } })
    expect(deps.store.listOperationRows()).toHaveLength(1)
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
    expect(await readPersistedTestAgentSessionStoreText(root, { hostId: 'host-1' })).toBe(before)
  })

  it('keeps durable metadata and UNKNOWN if Pack scope is lost after commit before dispatch', async () => {
    const id = await create()
    const commit = deps.store.hive.commit
    vi.spyOn(deps.store.hive, 'commit').mockImplementation(async (input) => {
      const decision = await commit(input)
      if (decision.decision === 'admit') {
        packCurrent = false
      }
      return decision
    })
    expect(await submit(id)).toMatchObject({ ok: true })
    await host.drain()
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
    expect(deps.store.hive.get(id)?.aggregate.generation).toMatchObject({
      state: 'UNKNOWN',
      executionBinding: { packRevision: 'b'.repeat(64) }
    })
    expect(await submit(id)).toEqual({ ok: false, error: { code: 'hive_agent_outcome_unknown' } })
  })

  it('rejects delayed provider output when a running Pack is revoked', async () => {
    let finish!: () => void
    const waiting = new Promise<void>((release) => {
      finish = release
    })
    const fake = new HiveAgentFakeAdapter({ wait: () => waiting })
    deps.adapter = fake
    const id = await create()
    const journal = await deps.journalFor(deps.store.hive.get(id)!)
    const append = vi.spyOn(journal, 'appendItem')
    const dispatch = vi.spyOn(journal, 'resolveDispatch')
    try {
      await submit(id)
      await vi.waitFor(() => expect(fake.dispatches).toBe(1))
      packCurrent = false
      finish()
      await host.drain()
      expect(dispatch).not.toHaveBeenCalled()
      expect(append).not.toHaveBeenCalled()
      expect(deps.store.hive.get(id)?.aggregate.generation?.state).toBe('UNKNOWN')
    } finally {
      finish()
      await host.drain()
    }
  })

  it('rechecks Pack after an awaited dispatch acknowledgement before publishing output', async () => {
    const id = await create()
    const journal = await deps.journalFor(deps.store.hive.get(id)!)
    const resolveDispatch = journal.resolveDispatch.bind(journal)
    const append = vi.spyOn(journal, 'appendItem')
    vi.spyOn(journal, 'resolveDispatch').mockImplementation(async (input) => {
      const result = await resolveDispatch(input)
      packManifest.packRevision = 'c'.repeat(64)
      return result
    })
    await submit(id)
    await host.drain()
    expect(append).not.toHaveBeenCalled()
    expect(deps.store.hive.get(id)?.aggregate.generation?.state).toBe('UNKNOWN')
  })

  it('replays authenticated durable receipts without current Pack availability or new dispatch', async () => {
    const id = await create()
    const operation = operationId()
    await submit(id, { operationId: operation })
    await host.drain()
    deps.readPack = undefined
    deps.resolveModel = undefined
    expect(await host.call('hiveAgent.read', { sessionId: id }, resolve)).toMatchObject({
      ok: true
    })
    expect(await host.call('hiveAgent.history', { sessionId: id }, resolve)).toMatchObject({
      ok: true
    })
    expect(await submit(id, { operationId: operation })).toMatchObject({
      ok: true,
      value: { replayed: true }
    })
    expect(await submit(id, { operationId: operation, text: 'changed' })).toEqual({
      ok: false,
      error: { code: 'hive_agent_operation_conflict' }
    })
    principal = { ...principal, accountId: 'other-account' }
    expect(await submit(id, { operationId: operation })).toEqual({
      ok: false,
      error: { code: 'hive_agent_forbidden' }
    })
    expect(client.catalog).toHaveBeenCalledOnce()
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(1)
  })
})

describe('P2 durable explicit model binding', () => {
  it.each([
    undefined,
    { ...selection, owner: 'other' },
    { ...selection, protocol: 'IMAGE' },
    { ...selection, snapshotRevision: 'stale' }
  ])('rejects missing or invalid selection before lookup or dispatch', async (modelSelection) => {
    const id = await create()
    expect(await submit(id, { modelSelection })).toEqual({
      ok: false,
      error: { code: 'hive_agent_invalid_request' }
    })
    expect(client.catalog).not.toHaveBeenCalled()
    expect(deps.store.listOperationRows()).toHaveLength(1)
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
  })
  it('reuses the strict W03 text validator before lookup', async () => {
    const id = await create()
    for (const text of [' ', '\uD800', 'x\u0000', '你'.repeat(4001)]) {
      expect(await submit(id, { text })).toEqual({
        ok: false,
        error: { code: 'hive_agent_invalid_request' }
      })
    }
    expect(client.catalog).not.toHaveBeenCalled()
  })
  it('freezes the durable choice through preference changes, reload and the next generation', async () => {
    let finish!: () => void
    const waiting = new Promise<void>((release) => {
      finish = release
    })
    const fake = new HiveAgentFakeAdapter({ wait: () => waiting })
    deps.adapter = fake
    const run = vi.spyOn(fake, 'run')
    const id = await create()
    await submit(id)
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    try {
      const original = deps.store.hive.get(id)!.aggregate.generation!
      expect(original.modelSelection).toEqual(selection)
      await reader.select(modelB)
      const supplied = run.mock.calls[0]![0].modelSelection
      expect(supplied).toEqual(selection)
      expect(Object.isFrozen(supplied)).toBe(true)
      expect(Reflect.set(supplied, 'modelId', 'poison')).toBe(false)
      expect(deps.store.hive.get(id)?.aggregate.generation?.modelSelection).toEqual(selection)
      finish()
      await host.drain()
      const reloaded = await openTestAgentSessionRecordStore(root, { hostId: 'host-1' })
      expect(reloaded.hive.get(id)?.aggregate.generation?.modelSelection).toEqual(selection)
      await submit(id, { modelSelection: modelB })
      await host.drain()
      const next = deps.store.hive.get(id)!.aggregate.generation!
      expect(next.generationId).not.toBe(original.generationId)
      expect(next.modelSelection).toEqual(modelB)
      expect(run.mock.calls[1]![0].modelSelection).toEqual(modelB)
      expect(supplied).toEqual(selection)
    } finally {
      finish()
      await host.drain()
    }
  })
  it.each([
    { ...selection, modelId: 'model-b' },
    { ...selection, protocol: 'RESPONSES' },
    { ...selection, snapshotRevision: 'b'.repeat(64) }
  ])(
    'includes the exact model, protocol and revision in durable replay identity',
    async (changed) => {
      const id = await create()
      const operation = operationId()
      await submit(id, { operationId: operation })
      await host.drain()
      client.catalog.mockResolvedValue({ ...catalog, models: [] })
      expect(await submit(id, { operationId: operation })).toMatchObject({
        ok: true,
        value: { replayed: true }
      })
      expect(await submit(id, { operationId: operation, modelSelection: changed })).toEqual({
        ok: false,
        error: { code: 'hive_agent_operation_conflict' }
      })
      expect(client.catalog).toHaveBeenCalledOnce()
      expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(1)
    }
  )
  it.each(['RUNNING', 'UNKNOWN'])('cannot replace a %s generation model', async (state) => {
    let finish!: () => void
    const waiting = new Promise<void>((release) => {
      finish = release
    })
    deps.adapter = new HiveAgentFakeAdapter(
      state === 'UNKNOWN' ? { crash: true } : { wait: () => waiting }
    )
    const id = await create()
    try {
      await submit(id)
      if (state === 'UNKNOWN') {
        await host.drain()
      }
      expect(await submit(id, { modelSelection: modelB })).toEqual({
        ok: false,
        error: { code: 'hive_agent_outcome_unknown' }
      })
      expect(deps.store.hive.get(id)?.aggregate.generation?.modelSelection).toEqual(selection)
      expect(client.catalog).toHaveBeenCalledOnce()
    } finally {
      finish()
      await host.drain()
    }
  })
  it('refuses missing lookup dependencies and unavailable models without recording a turn', async () => {
    const id = await create()
    const resolveModel = deps.resolveModel
    deps.resolveModel = undefined
    expect(await submit(id)).toEqual({
      ok: false,
      error: { code: 'hive_agent_capability_unavailable' }
    })
    deps.resolveModel = resolveModel
    client.catalog.mockResolvedValue({ ...catalog, models: [] })
    expect(await submit(id)).toEqual({ ok: false, error: { code: 'hive_agent_model_unavailable' } })
    expect(deps.store.hive.get(id)?.aggregate.generation).toBeUndefined()
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
    expect(deps.store.listOperationRows()).toHaveLength(1)
  })
  it('rechecks model authority inside the existing transaction before writing', async () => {
    const id = await create()
    const before = await readPersistedTestAgentSessionStoreText(root, { hostId: 'host-1' })
    const commit = deps.store.hive.commit
    vi.spyOn(deps.store.hive, 'commit').mockImplementationOnce((input) => {
      auth = null
      return commit(input)
    })
    expect(await submit(id)).toEqual({ ok: false, error: { code: 'hive_agent_model_unavailable' } })
    expect(await readPersistedTestAgentSessionStoreText(root, { hostId: 'host-1' })).toBe(before)
    expect(deps.store.hive.get(id)?.aggregate.generation).toBeUndefined()
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
  })
  it('retains an UNKNOWN bound generation without dispatch after post-commit revocation', async () => {
    const id = await create()
    const commit = deps.store.hive.commit
    vi.spyOn(deps.store.hive, 'commit').mockImplementationOnce(async (input) => {
      const decision = await commit(input)
      auth = null
      return decision
    })
    expect(await submit(id)).toMatchObject({ ok: true, value: { status: 'pending' } })
    await host.drain()
    expect(deps.store.hive.get(id)?.aggregate.generation).toMatchObject({
      state: 'UNKNOWN',
      modelSelection: selection
    })
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
    expect((await deps.journalFor(deps.store.hive.get(id)!)).snapshot().items).toEqual([])
  })
  it.each(['text', 'completed'] as const)(
    'rejects a %s event when authority changes during journal dispatch acknowledgement',
    async (type) => {
      deps.adapter = new HiveAgentFakeAdapter({
        events: [
          type === 'text'
            ? { sequence: 1, type, text: 'late private output' }
            : { sequence: 1, type }
        ]
      })
      const id = await create()
      const journal = await deps.journalFor(deps.store.hive.get(id)!)
      const acknowledge = journal.resolveDispatch.bind(journal)
      vi.spyOn(journal, 'resolveDispatch').mockImplementationOnce(async (input) => {
        const result = await acknowledge(input)
        auth = null
        return result
      })
      expect(await submit(id)).toMatchObject({ ok: true })
      await host.drain()
      expect(deps.store.hive.get(id)?.aggregate.generation).toMatchObject({
        state: 'UNKNOWN',
        modelSelection: selection
      })
      expect(journal.snapshot().items).toHaveLength(1)
      expect(journal.snapshot().items[0]?.body).toMatchObject({ role: 'user' })
    }
  )
  it.each([
    { state: 'RUNNING', lateResult: 'success', conflict: false },
    { state: 'UNKNOWN', lateResult: 'success', conflict: false },
    { state: 'COMPLETED', lateResult: 'failure', conflict: false },
    { state: 'COMPLETED', lateResult: 'refresh', conflict: false },
    { state: 'RUNNING', lateResult: 'success', conflict: true }
  ])('reconciles a late lookup with the recorded operation: %j', async (scenario) => {
    let releaseQuery!: (value: typeof catalog) => void
    let failQuery!: (error: Error) => void
    client.catalog.mockReturnValueOnce(
      new Promise((accept, reject) => {
        releaseQuery = accept
        failQuery = reject
      })
    )
    let finish!: () => void
    const waiting = new Promise<void>((release) => {
      finish = release
    })
    const fake = new HiveAgentFakeAdapter(
      scenario.state === 'RUNNING'
        ? { wait: () => waiting }
        : { crash: scenario.state === 'UNKNOWN' }
    )
    deps.adapter = fake
    const id = await create()
    const operation = operationId()
    const late = submit(id, { operationId: operation })
    try {
      expect(
        await submit(id, {
          operationId: operation,
          modelSelection: scenario.conflict ? modelB : selection
        })
      ).toMatchObject({ ok: true })
      await vi.waitFor(() => expect(fake.dispatches).toBe(1))
      if (scenario.state !== 'RUNNING') {
        await host.drain()
      }
      const before = deps.store.hive.get(id)
      if (scenario.lateResult === 'refresh') {
        auth = { ...auth!, accessToken: 'refreshed-fixture-token', sessionGeneration: 2 }
      }
      if (scenario.lateResult === 'failure') {
        failQuery(new Error('catalog fixture unavailable'))
      } else {
        releaseQuery(catalog)
      }
      const result = await late
      expect(result).toMatchObject(
        scenario.conflict
          ? { ok: false, error: { code: 'hive_agent_operation_conflict' } }
          : {
              ok: true,
              value: {
                operationId: operation,
                replayed: true,
                status:
                  scenario.state === 'RUNNING'
                    ? 'pending'
                    : scenario.state === 'UNKNOWN'
                      ? 'unknown'
                      : 'succeeded'
              }
            }
      )
      expect(deps.store.hive.get(id)).toEqual(before)
      expect(deps.store.listOperationRows()).toHaveLength(2)
      expect(fake.dispatches).toBe(1)
      expect(client.catalog).toHaveBeenCalledTimes(2)
    } finally {
      releaseQuery(catalog)
      await late
      finish()
      await host.drain()
    }
  })
  it('returns the recorded receipt after journal opening spans a login refresh', async () => {
    const id = await create()
    const operation = operationId()
    const journal = await deps.journalFor(deps.store.hive.get(id)!)
    let releaseJournal!: (value: typeof journal) => void
    const opening = vi.spyOn(deps, 'journalFor').mockReturnValueOnce(
      new Promise((accept) => {
        releaseJournal = accept
      })
    )
    const late = submit(id, { operationId: operation })
    try {
      await vi.waitFor(() => expect(opening).toHaveBeenCalledOnce())
      expect(await submit(id, { operationId: operation })).toMatchObject({ ok: true })
      await host.drain()
      const before = deps.store.hive.get(id)
      const history = journal.snapshot().items
      auth = { ...auth!, accessToken: 'refreshed-fixture-token', sessionGeneration: 2 }
      releaseJournal(journal)
      expect(await late).toMatchObject({
        ok: true,
        value: { operationId: operation, replayed: true, status: 'succeeded' }
      })
      expect(deps.store.hive.get(id)).toEqual(before)
      expect(journal.snapshot().items).toEqual(history)
      expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(1)
    } finally {
      releaseJournal(journal)
      await late
    }
  })
  it.each(['account', 'expiry', 'closed'])(
    'denies an existing receipt when the pending caller loses %s authority',
    async (change) => {
      let releaseQuery!: (value: typeof catalog) => void
      client.catalog.mockReturnValueOnce(
        new Promise((accept) => {
          releaseQuery = accept
        })
      )
      const id = await create()
      const operation = operationId()
      const late = submit(id, { operationId: operation })
      try {
        expect(await submit(id, { operationId: operation })).toMatchObject({ ok: true })
        await host.drain()
        const before = deps.store.hive.get(id)
        if (change === 'closed') {
          await host.close()
        } else {
          principal =
            change === 'account'
              ? { ...principal, accountId: 'other-account' }
              : { ...principal, expiry: NOW }
        }
        releaseQuery(catalog)
        expect(await late).toEqual({
          ok: false,
          error: {
            code: change === 'closed' ? 'hive_agent_capability_unavailable' : 'hive_agent_forbidden'
          }
        })
        expect(deps.store.hive.get(id)).toEqual(before)
        expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(1)
      } finally {
        releaseQuery(catalog)
        await late
      }
    }
  )
  it('does not let a late lookup replace a newer completed generation', async () => {
    let release!: (value: typeof catalog) => void
    client.catalog.mockReturnValueOnce(
      new Promise((resolveCatalog) => {
        release = resolveCatalog
      })
    )
    const id = await create()
    const late = submit(id)
    await submit(id, { modelSelection: modelB })
    await host.drain()
    const bound = deps.store.hive.get(id)!.aggregate.generation!
    release(catalog)
    expect(await late).toEqual({ ok: false, error: { code: 'hive_agent_operation_conflict' } })
    expect(deps.store.hive.get(id)?.aggregate.generation).toEqual(bound)
    expect(bound.modelSelection).toEqual(modelB)
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(1)
  })
  it('rejects a lookup result arriving after host closure', async () => {
    let release!: (value: typeof catalog) => void
    client.catalog.mockReturnValueOnce(
      new Promise((resolveCatalog) => {
        release = resolveCatalog
      })
    )
    const id = await create()
    const late = submit(id)
    await host.close()
    release(catalog)
    expect(await late).toEqual({ ok: false, error: { code: 'hive_agent_capability_unavailable' } })
    expect(deps.store.hive.get(id)?.aggregate.generation).toBeUndefined()
    expect((deps.adapter as HiveAgentFakeAdapter).dispatches).toBe(0)
  })
})
