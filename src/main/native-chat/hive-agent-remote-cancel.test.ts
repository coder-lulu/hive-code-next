import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  HIVE_AGENT_METHODS,
  type AuthenticatedRuntimePrincipal
} from '../../shared/hive-agent-session-methods'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
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
  store = await openTestAgentSessionRecordStore(root, { hostId: 'host-1' })
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
  vi.useRealTimers()
  await host.close()
  await journals.closeAll()
  await rm(root, { recursive: true, force: true })
})

it.each(['succeeded', 'unknown'] as const)(
  'persists remote cancellation %s without duplicate POSTs',
  async (status) => {
    deps.adapter = new HiveAgentFakeAdapter({
      wait: (signal) =>
        new Promise<void>((done) => {
          if (signal.aborted) {
            done()
          } else {
            signal.addEventListener('abort', () => done(), { once: true })
          }
        })
    })
    let finish!: () => void
    const waiting = new Promise<void>((done) => {
      finish = done
    })
    deps.cancelExecution = vi.fn(async () => {
      await waiting
      if (status === 'unknown') {
        throw new Error('private-error')
      }
    })
    const id = await create()
    await call('submit', { sessionId: id, operationId: operationId(), text: 'cancel me' })
    const generationId = store.hive.get(id)!.aggregate.generation!.generationId
    const command = { sessionId: id, generationId, operationId: operationId() }
    const first = call('cancel', command)
    await vi.waitFor(() => expect(deps.cancelExecution).toHaveBeenCalledOnce())
    expect(await call('cancel', command)).toMatchObject({
      ok: true,
      value: { status: 'pending', replayed: true }
    })
    expect(store.hive.get(id)?.aggregate.generation?.state).toBe('CANCELLED')
    finish()
    expect(await first).toMatchObject({ ok: true, value: { status } })
    await host.drain()
    await host.close()
    const reopened = await openTestAgentSessionRecordStore(root, { hostId: 'host-1' })
    host = await HiveAgentSessionHost.open({ ...deps, store: reopened })
    expect(await call('cancel', command)).toMatchObject({
      ok: true,
      value: { status, replayed: true }
    })
    expect(deps.cancelExecution).toHaveBeenCalledOnce()
  }
)
