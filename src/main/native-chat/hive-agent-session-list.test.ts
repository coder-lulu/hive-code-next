import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HIVE_AGENT_METHODS,
  hiveAgentSessionListSchema,
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
const ARTIFACT_ROOT = join(process.cwd(), 'logs/p4-session-list/stores')
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
  const artifactRoot = ARTIFACT_ROOT
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
  if (dirname(root) !== ARTIFACT_ROOT) {
    throw new Error('Invalid fixture cleanup path')
  }
  await rm(root, { recursive: true, force: true })
})

describe('HiveAgent private session listing', () => {
  it('lists only current owner/device/project sessions and omits deleted history', async () => {
    const own = { ...principal! }
    const visible = await create()
    for (const patch of [
      { accountId: 'other-account' },
      { deviceId: 'other-device' },
      { projectScope: 'other-project' }
    ]) {
      principal = { ...own, ...patch }
      await create()
    }
    principal = own
    const deleted = await create()
    expect(await call('delete', { sessionId: deleted, operationId: operationId() })).toMatchObject({
      ok: true
    })
    const result = (await call('list', {})) as { ok: boolean; value: unknown }
    expect(result.ok).toBe(true)
    const page = hiveAgentSessionListSchema.parse(result.value)
    expect(page.sessions.map((session) => session.sessionId)).toEqual([visible])
    expect(page.nextCursor).toBeNull()
    expect(JSON.stringify(page)).not.toMatch(/accountId|deviceId|projectScope|encryptedSecretRef/)
  })
  it('pages sessions deterministically across equal creation times and restart', async () => {
    const ids = await Promise.all(Array.from({ length: 4 }, () => create()))
    const first = (await call('list', { limit: 2 })) as { value: unknown }
    const page = hiveAgentSessionListSchema.parse(first.value)
    expect(page.sessions.map((session) => session.sessionId)).toEqual(
      ids.toSorted().toReversed().slice(0, 2)
    )
    expect(page.nextCursor).not.toBeNull()
    await host.close()
    store = await AgentSessionRecordStore.open({ directory: root, hostId: 'host-1' })
    deps.store = store
    host = await HiveAgentSessionHost.open(deps)
    const next = (await call('list', { limit: 2, before: page.nextCursor })) as { value: unknown }
    const last = hiveAgentSessionListSchema.parse(next.value)
    expect(last.sessions.map((session) => session.sessionId)).toEqual(
      ids.toSorted().toReversed().slice(2)
    )
    expect(last.nextCursor).toBeNull()
  })
  it.each([{ owner: 'other' }, { limit: 101 }, { limit: 0 }, { before: { sessionId: 'invalid' } }])(
    'rejects invalid session list commands before reading entries: %j',
    async (params) => {
      const read = vi.spyOn(store.hive, 'list')
      expect(await call('list', params)).toMatchObject({ ok: false })
      expect(read).not.toHaveBeenCalled()
    }
  )
  it('rejects expired list authority before reading the store', async () => {
    const read = vi.spyOn(store.hive, 'list')
    principal = { ...principal!, expiry: NOW }
    expect(await call('list', {})).toEqual({ ok: false, error: { code: 'hive_agent_forbidden' } })
    expect(read).not.toHaveBeenCalled()
  })
})
