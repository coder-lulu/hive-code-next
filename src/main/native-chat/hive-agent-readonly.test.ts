import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  HIVE_AGENT_METHODS,
  type AuthenticatedRuntimePrincipal
} from '../../shared/hive-agent-session-methods'
import { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { HiveAgentSessionHost } from './hive-agent-session-host'
import type { HiveAgentHostDependencies } from './hive-agent-session-dependencies'
import { HiveAgentFakeAdapter } from './hive-agent-fake-adapter'
import { createTrackedJournalOpener } from './agent-session-journal/journal-host-database-test-support'
import type { AgentSessionJournal } from './agent-session-journal/journal-store'
import { accountModelSelectionFixture as selection } from '../../shared/hive-ai-model-catalog.test-fixture'
import { textPackManifestFixture } from './hive-agent-text-pack.test-fixture'

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

it('keeps authorized history readable without recovery writes when execution is unavailable', async () => {
  deps.adapter = new HiveAgentFakeAdapter({
    events: [{ sequence: 1, type: 'text', text: 'partial' }]
  })
  const id = await create()
  await call('submit', { sessionId: id, operationId: operationId(), text: 'retained question' })
  await host.drain()
  expect(store.hive.get(id)?.aggregate.generation?.state).toBe('UNKNOWN')
  await host.close()
  const settle = vi.spyOn(store.hive, 'settle')
  const commit = vi.spyOn(store.hive, 'commit')
  host = await HiveAgentSessionHost.open({
    ...deps,
    executionUnavailable: 'hive_agent_pack_unavailable'
  })
  for (const method of ['read', 'history', 'export']) {
    expect(await call(method, { sessionId: id })).toMatchObject({ ok: true })
  }
  expect(await call('list', {})).toMatchObject({ ok: true })
  const emit = vi.fn()
  const stop = await host.subscribe({ sessionId: id }, resolve, emit)
  expect(emit).toHaveBeenCalled()
  stop()
  for (const method of ['create', 'submit', 'cancel', 'delete']) {
    expect(
      await call(method, { sessionId: id, operationId: operationId(), profileId: 'personal' })
    ).toMatchObject({ ok: false, error: { code: 'hive_agent_pack_unavailable' } })
  }
  expect(settle).not.toHaveBeenCalled()
  expect(commit).not.toHaveBeenCalled()
  principal = null
  expect(await call('export', { sessionId: id })).toMatchObject({
    ok: false,
    error: { code: 'hive_agent_forbidden' }
  })
})
