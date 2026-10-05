import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { produceManagedPiTextPack } from '../build-plugins/managed-pi-pack-producer'
import { loadManagedPiTextPack } from '../../src/main/runtime/managed-pi-pack-loader'
import { AGENT_SESSION_LEASE_TTL_MS } from '../../src/main/runtime/agent-session-record-store'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore
} from '../../src/main/runtime/agent-session-record-store-test-harness'
import { openManagedPiProcessSupervisor } from '../../src/main/runtime/managed-pi-process-supervisor'
import { createManagedPiExecutionHost } from '../../src/main/native-chat/managed-pi-execution-host'
import {
  reserveManagedPiExecutionLease,
  managedPiExecutionRecordId
} from '../../src/main/runtime/managed-pi-execution-lease'
import { HiveAgentSessionHost } from '../../src/main/native-chat/hive-agent-session-host'
import { createTrackedJournalOpener } from '../../src/main/native-chat/agent-session-journal/journal-host-database-test-support'
import { HIVE_AGENT_METHODS } from '../../src/shared/hive-agent-session-methods'
import { isAgentSessionRecord } from '../../src/shared/agent-session-record'
import {
  isAgentSessionHandleProvider,
  isAgentSessionProviderHandle,
  agentSessionProviderHandleRoot
} from '../../src/shared/agent-session-provider-handle'
import { adapterSupportsRecord } from '../../src/main/native-chat/agent-session-wire/structured-agent-session-provider-support'
import { restoreStructuredAgentSessionRead } from '../../src/main/native-chat/agent-session-wire/structured-agent-session-read-restore'
import { listStructuredProviderSessionOwnership } from '../../src/main/native-chat/agent-session-wire/structured-provider-session-ownership'
import { StructuredAgentSessionHostRuntimeState } from '../../src/main/native-chat/agent-session-wire/structured-agent-session-host-runtime-state'
import { HiveAgentLocalPrincipal } from '../../src/main/native-chat/hive-agent-local-principal'
import { EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP } from '../../src/shared/hive-runtime-cloud'
import type { ManagedPiTextInference } from '../../src/main/native-chat/managed-pi-inference-pump'
import type { HiveAgentHostDependencies } from '../../src/main/native-chat/hive-agent-session-dependencies'

let root: string
let pack: Awaited<ReturnType<typeof loadManagedPiTextPack>>
const disposers: (() => Promise<void>)[] = []
beforeAll(async () => {
  const base = resolve('logs/managed-pi-execution-tests')
  await mkdir(base, { recursive: true })
  root = await mkdtemp(join(base, 'owned Pi with spaces 中文-'))
  const built = await produceManagedPiTextPack(resolve('.'), join(root, 'pack'))
  pack = await loadManagedPiTextPack({ rootDirectory: built.root, indexSha256: built.indexSha256 })
}, 15000)
afterEach(async () => {
  for (const dispose of disposers.splice(0).toReversed()) {
    await dispose()
  }
})
afterAll(async () => {
  pack?.dispose()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture(
  inference?: ManagedPiTextInference,
  identity?: { accountId: string; deviceId: string; assertAuthorized?: () => void }
) {
  const directory = await mkdtemp(join(root, 'session-'))
  const store = await openTestAgentSessionRecordStore(directory)
  let authorized = true
  let clock = Date.now()
  const now = () => clock
  const assertAuthorized = () => {
    if (!authorized) {
      throw new Error('hive_agent_forbidden')
    }
    identity?.assertAuthorized?.()
  }
  const scope = {
    accountId: identity?.accountId ?? 'account-1',
    deviceId: identity?.deviceId ?? 'device-1',
    runtimeRecordId: 'actual_pi_host',
    projectScope: 'folder-1',
    workspaceKind: 'folder' as const
  }
  const run = vi.fn(
    inference?.run ??
      async function* () {
        yield { type: 'text' as const, text: 'owned reply' }
        yield { type: 'completed' as const, text: 'owned reply' }
      }
  )
  const execution = await createManagedPiExecutionHost({
    store,
    pack,
    ...scope,
    homeRoot: join(directory, 'home'),
    claimKeyId: 'actual-host-test-key',
    scopeFor: (entry) => ({ ...scope, sessionId: entry.aggregate.session.sessionId }),
    assertAuthorized,
    inference: { run },
    now
  })
  const journals = createTrackedJournalOpener()
  const opened = new Map<string, Awaited<ReturnType<typeof journals.open>>>()
  const deps: HiveAgentHostDependencies = {
    store,
    runtimeRecordId: scope.runtimeRecordId,
    adapter: execution.adapter,
    readPack: execution.readPack,
    fenceFor: execution.fenceFor,
    now,
    enabled: () => true,
    eligibilityRevision: () => 1,
    closeExecution: execution.close,
    releaseExecution: execution.release,
    resolveModel: async (selection) => ({ selection, assertCurrent: assertAuthorized }),
    journalFor: async (entry) => {
      const sessionId = entry.aggregate.session.sessionId
      let journal = opened.get(sessionId)
      if (!journal) {
        const identity = {
          sessionId,
          workspaceId: scope.projectScope,
          hostId: 'local',
          agent: 'pi',
          providerHandle: { kind: 'opaque' as const, agent: 'pi', value: sessionId }
        }
        journal = await journals.open({
          identity,
          stateDirectory: directory
        })
        opened.set(sessionId, journal)
      }
      return journal
    }
  }
  const host = await HiveAgentSessionHost.open(deps)
  disposers.push(async () => {
    await host.close()
    await journals.closeAll()
  })
  const principal = () =>
    authorized
      ? {
          ...scope,
          kind: 'local' as const,
          expiry: clock + 60000,
          allowedMethods: Object.keys(HIVE_AGENT_METHODS),
          toolScopes: [],
          eligibilityRevision: 1
        }
      : null
  const operationId = () => `${now()}-${randomUUID().replaceAll('-', '')}`
  const create = async () => {
    const sessionId = `ha-session:${randomUUID()}`
    expect(
      await host.call(
        'hiveAgent.create',
        { sessionId, profileId: 'personal', operationId: operationId() },
        principal
      )
    ).toMatchObject({ ok: true })
    return sessionId
  }
  const submit = (
    sessionId: string,
    protocol: 'CHAT_COMPLETIONS' | 'RESPONSES' = 'CHAT_COMPLETIONS'
  ) =>
    host.call(
      'hiveAgent.submit',
      {
        sessionId,
        operationId: operationId(),
        text: 'owned question',
        modelSelection: { modelId: 'owned-model', protocol, snapshotRevision: 'a'.repeat(64) }
      },
      principal
    )
  const record = (sessionId: string) => store.getRecord(managedPiExecutionRecordId(sessionId))!
  const leaseOptions = (sessionId: string) => ({
    store,
    scope: { ...scope, sessionId },
    pack,
    homeRoot: join(directory, 'home'),
    claimKeyId: 'actual-host-test-key',
    assertAuthorized,
    now
  })
  return {
    directory,
    store,
    host,
    execution,
    deps,
    opened,
    run,
    create,
    submit,
    record,
    operationId,
    principal,
    leaseOptions,
    revoke: () => {
      authorized = false
    },
    advance: (ms: number) => {
      clock += ms
    }
  }
}
async function independentExecution(f: Awaited<ReturnType<typeof fixture>>, sessionId: string) {
  const options = f.leaseOptions(sessionId)
  const execution = await createManagedPiExecutionHost({
    ...options,
    runtimeRecordId: options.scope.runtimeRecordId,
    scopeFor: (entry) => ({ ...options.scope, sessionId: entry.aggregate.session.sessionId }),
    assertAuthorized: options.assertAuthorized,
    inference: { run: f.run }
  })
  disposers.push(execution.close)
  return execution
}
it.each(['scalar', 'batched'] as const)(
  'excludes actual Pi leases from the external runtime %s renewer',
  async (mode) => {
    const f = await fixture()
    const id = await f.create()
    await f.submit(id)
    await f.host.drain()
    const before = f.record(id)
    f.advance(1000)
    const proof = { outcome: 'identity-matched', matchedOn: ['pid'] } as const
    const probeOwner = vi.fn(async (_record: typeof before) => proof)
    const probeOwners = vi.fn(
      async (records: readonly (typeof before)[]) =>
        new Map(records.map((record) => [record.sessionId, proof]))
    )
    const unused = async () => {
      throw new Error('The external runtime must not acquire this test Pi.')
    }
    const external = new StructuredAgentSessionHostRuntimeState({
      store: f.store,
      adapter: {
        acquire: unused,
        dispatch: unused,
        cancelTurn: unused,
        answerPrompt: unused,
        setOption: unused
      },
      journalRoot: f.directory,
      claimKeyId: 'external-runtime-test-key',
      now: f.leaseOptions(id).now,
      probeOwner,
      ...(mode === 'batched' ? { probeOwners } : {})
    })
    const intervals = vi.spyOn(globalThis, 'setInterval')
    const renewals = vi.spyOn(f.store, 'renewLeases')
    try {
      external.startLeaseRenewal()
      const tick = intervals.mock.calls[0]?.[0]
      if (typeof tick !== 'function') {
        throw new Error('The external renewer did not register its timer.')
      }
      tick()
      await vi.waitFor(() => expect(renewals).toHaveBeenCalled())
      await renewals.mock.results.at(-1)!.value
      expect(probeOwner).not.toHaveBeenCalled()
      expect(probeOwners.mock.calls.flatMap(([records]) => records)).toEqual([])
      expect(f.record(id)).toEqual(before)
      expect(() => process.kill(before.lease.ownerProcess!.pid, 0)).not.toThrow()
    } finally {
      external.stopLeaseRenewal()
      vi.restoreAllMocks()
    }
  }
)
it('stops the lease timer when the actual owned child exits independently', async () => {
  const intervals = vi.spyOn(globalThis, 'setInterval')
  const clears = vi.spyOn(globalThis, 'clearInterval')
  try {
    const f = await fixture()
    const id = await f.create()
    await f.submit(id)
    await f.host.drain()
    const index = intervals.mock.calls.findIndex(
      ([, delay]) => delay === Math.floor(AGENT_SESSION_LEASE_TTL_MS / 3)
    )
    expect(index).toBeGreaterThanOrEqual(0)
    const timer = intervals.mock.results[index].value
    process.kill(f.record(id).lease.ownerProcess!.pid)
    await vi.waitFor(() => expect(f.record(id).lease.claimStatus).toBe('released'))
    expect(clears.mock.calls.some(([handle]) => handle === timer)).toBe(true)
  } finally {
    vi.restoreAllMocks()
  }
})
it('refuses release without a local handle while another owned Pi child is still live', async () => {
  const f = await fixture()
  const id = await f.create()
  await f.submit(id)
  await f.host.drain()
  const independent = await independentExecution(f, id)
  const before = structuredClone(f.record(id))
  await expect(independent.release(id)).rejects.toThrow('hive_agent_outcome_unknown')
  expect(f.record(id)).toEqual(before)
  expect(() => process.kill(before.lease.ownerProcess!.pid, 0)).not.toThrow()
  expect(f.run).toHaveBeenCalledTimes(1)
})
it('requires exit verification before recovering an unfinished deletion', async () => {
  const f = await fixture()
  const id = await f.create()
  await f.submit(id)
  await f.host.drain()
  const independent = await independentExecution(f, id)
  const journal = f.opened.get(id)!
  const before = structuredClone(journal.snapshot().items)
  f.deps.releaseExecution = async () => {
    throw new Error('hive_agent_outcome_unknown')
  }
  expect(
    await f.host.call(
      'hiveAgent.delete',
      { sessionId: id, operationId: f.operationId() },
      f.principal
    )
  ).toMatchObject({ ok: false, error: { code: 'hive_agent_outcome_unknown' } })
  expect(f.store.hive.get(id)?.deletedAt).toBeDefined()
  expect(() => process.kill(f.record(id).lease.ownerProcess!.pid, 0)).not.toThrow()
  const reopening = HiveAgentSessionHost.open({
    ...f.deps,
    adapter: independent.adapter,
    fenceFor: independent.fenceFor,
    releaseExecution: independent.release,
    closeExecution: independent.close
  })
  void reopening.then(
    (host) => disposers.push(() => host.close()),
    () => {}
  )
  await expect(reopening).rejects.toThrow('hive_agent_outcome_unknown')
  expect(f.store.hive.get(id)?.deletionComplete).not.toBe(true)
  expect(journal.snapshot().items).toEqual(before)
})
it('keeps close failure visible on subsequent close calls', async () => {
  const f = await fixture()
  const id = await f.create()
  await f.submit(id)
  await f.host.drain()
  const pid = f.record(id).lease.ownerProcess!.pid
  vi.spyOn(f.store, 'transitionHandoff').mockRejectedValueOnce(
    new Error('injected exit write failure')
  )
  await expect(f.execution.close()).rejects.toThrow('hive_agent_outcome_unknown')
  expect(() => process.kill(pid, 0)).toThrow()
  // The test deliberately broke the exit write; teardown has already observed process death.
  f.deps.closeExecution = undefined
  await expect(f.execution.close()).rejects.toThrow('hive_agent_outcome_unknown')
  expect(f.record(id).lease.claimStatus).toBe('live')
})
it('uses the main-process principal proof for actual Pi and refuses a revoked identity transaction', async () => {
  const accountId = '11111111-1111-4111-8111-111111111111'
  const deviceId = '22222222-2222-4222-8222-222222222222'
  let binding: Awaited<ReturnType<HiveAgentLocalPrincipal['bindProject']>> | undefined
  const f = await fixture(undefined, {
    accountId,
    deviceId,
    assertAuthorized: () => {
      if (!binding?.resolvePrincipal()) {
        throw new Error('hive_agent_forbidden')
      }
    }
  })
  const authorization = {
    accountId,
    authorityId: 'authority',
    accessToken: 'private-identity-test-credential',
    sessionGeneration: 1,
    sessionExpiresAt: Date.now() + 120_000
  }
  const owner = {
    ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
    relation: 'CLAIMED_BY_CURRENT' as const,
    presence: 'ONLINE' as const,
    accountId,
    sessionGeneration: 1,
    runtimeRecordId: 'actual_pi_host'
  }
  const producer = new HiveAgentLocalPrincipal(
    {
      getRuntimeCloudAuthorization: () => authorization,
      subscribeRuntimeCloudAuthorization: () => () => {}
    },
    {
      getState: () => owner,
      subscribe: (listener) => {
        listener(owner)
        return () => {}
      }
    },
    () => ({
      configured: true,
      config: {
        apiBaseUrl: 'https://cloud.example.test',
        identityIssuer: '',
        userLoginUrl: '',
        clientId: '',
        scope: ''
      }
    }),
    async () => ({ projectScope: 'folder-1', workspaceKind: 'folder', assertCurrent: () => {} }),
    () => ({
      getCurrentIdentity: async () => ({
        contract: 'hive-runtime-local-identity-v1',
        accountId,
        deviceId,
        authorityId: 'authority',
        expiresAt: Date.now() + 90_000
      })
    })
  )
  disposers.push(async () => producer.stop())
  binding = await producer.bindProject('local-project')
  f.deps.eligibilityRevision = () => producer.eligibilityRevision()
  const id = `ha-session:${randomUUID()}`
  expect(
    await f.host.call(
      'hiveAgent.create',
      {
        sessionId: id,
        operationId: f.operationId(),
        profileId: 'personal'
      },
      binding.resolvePrincipal
    )
  ).toMatchObject({ ok: true })
  const submit = () =>
    f.host.call(
      'hiveAgent.submit',
      {
        sessionId: id,
        operationId: f.operationId(),
        text: 'authorized question',
        modelSelection: {
          modelId: 'owned-model',
          protocol: 'CHAT_COMPLETIONS',
          snapshotRevision: 'a'.repeat(64)
        }
      },
      binding!.resolvePrincipal
    )
  expect(await submit()).toMatchObject({ ok: true })
  await f.host.drain()
  expect(f.record(id).options).toMatchObject({ accountId, deviceId })
  expect(f.run).toHaveBeenCalledOnce()
  await f.execution.release(id)
  const transition = f.store.transitionHandoff.bind(f.store)
  vi.spyOn(f.store, 'transitionHandoff').mockImplementationOnce((sessionId, update) => {
    producer.stop()
    return transition(sessionId, update)
  })
  expect(await submit()).toMatchObject({ ok: true })
  await f.host.drain()
  expect(binding.resolvePrincipal()).toBeNull()
  expect(f.run).toHaveBeenCalledOnce()
  expect(f.store.hive.get(id)?.aggregate.generation?.state).not.toBe('COMPLETED')
  expect(f.record(id).lease.claimStatus).toBe('released')
})
it.each(['CHAT_COMPLETIONS', 'RESPONSES'] as const)(
  'connects %s to P2 through the same durable lease and actual Pi process',
  async (protocol) => {
    const f = await fixture()
    const sessionId = await f.create()
    expect(f.store.listRecords()).toHaveLength(0)
    expect(await f.submit(sessionId, protocol)).toMatchObject({ ok: true })
    await f.host.drain()
    expect(f.store.hive.get(sessionId)?.aggregate.generation?.state).toBe('COMPLETED')
    const record = f.record(sessionId)
    expect(isAgentSessionRecord(record)).toBe(true)
    expect(record).toMatchObject({
      provider: 'managed-pi',
      options: { hiveSessionId: sessionId },
      lease: { claimStatus: 'live', runtimeFence: 1, ownerProcess: { hostId: 'local' } }
    })
    const pid = record.lease.ownerProcess!.pid
    expect(await f.submit(sessionId, protocol)).toMatchObject({ ok: true })
    await f.host.drain()
    expect(f.record(sessionId).lease.ownerProcess!.pid).toBe(pid)
    expect(f.record(sessionId).providerHandleChain).toHaveLength(1)
    expect(f.run).toHaveBeenCalledTimes(2)
    const persisted = await readPersistedTestAgentSessionStore(f.directory)
    expect(JSON.stringify(persisted)).toContain('managed-pi')
    await f.host.close()
    expect(f.record(sessionId).lease).toMatchObject({
      claimStatus: 'released',
      runtimeFence: 2,
      ownerProcess: null,
      deathEvidence: { kind: 'exit-observed' }
    })
  }
)
it('excludes owned Pi records from external-provider restoration and ownership indexes', async () => {
  const f = await fixture()
  const id = await f.create()
  await f.submit(id)
  await f.host.drain()
  const record = f.record(id)
  expect(isAgentSessionHandleProvider('managed-pi')).toBe(false)
  expect(adapterSupportsRecord({ supportsCreate: () => true }, record)).toBe(false)
  expect(listStructuredProviderSessionOwnership([record])).toEqual([])
  expect(
    await restoreStructuredAgentSessionRead(
      { store: f.store, journalRoot: f.directory, adapter: {} },
      record.sessionId
    )
  ).toBeNull()
  expect(
    isAgentSessionRecord({ ...record, accountHome: { variable: 'CODEX_HOME', path: '/' } })
  ).toBe(false)
  expect(
    isAgentSessionRecord({
      ...record,
      location: { ...record.location, executionHostId: 'ssh:host' }
    })
  ).toBe(false)
  expect(
    isAgentSessionRecord({
      ...record,
      lease: { ...record.lease, ownerProcess: { ...record.lease.ownerProcess, hostId: 'ssh:host' } }
    })
  ).toBe(false)
  const handle = { provider: 'managed-pi', sessionId: id }
  expect(isAgentSessionProviderHandle(handle)).toBe(true)
  expect(isAgentSessionProviderHandle({ ...handle, threadId: 'not-codex' })).toBe(false)
  expect(agentSessionProviderHandleRoot(record.providerHandleChain[0].handle)).toBe(
    `managed-pi:${JSON.stringify(id)}`
  )
})
it('refuses a second owner even after expiry without proof of exit', async () => {
  const f = await fixture()
  const id = await f.create()
  await f.submit(id)
  await f.host.drain()
  const prior = structuredClone(f.record(id))
  f.advance(40000)
  await expect(reserveManagedPiExecutionLease(f.leaseOptions(id))).rejects.toThrow(
    'hive_agent_outcome_unknown'
  )
  expect(f.record(id)).toEqual(prior)
  expect(f.run).toHaveBeenCalledTimes(1)
})
it('rechecks authorization inside the reservation transaction', async () => {
  const f = await fixture()
  const id = await f.create()
  const reserve = f.store.reserveOwner.bind(f.store)
  vi.spyOn(f.store, 'reserveOwner').mockImplementationOnce((args) => {
    f.revoke()
    return reserve(args)
  })
  await expect(reserveManagedPiExecutionLease(f.leaseOptions(id))).rejects.toThrow(
    'hive_agent_forbidden'
  )
  expect(f.store.listRecords()).toEqual([])
})
it('does not dispatch inference when authorization is revoked during process identity commit', async () => {
  const f = await fixture()
  const id = await f.create()
  const transition = f.store.transitionHandoff.bind(f.store)
  let commits = 0
  vi.spyOn(f.store, 'transitionHandoff').mockImplementation(async (recordId, apply) => {
    const result = await transition(recordId, apply)
    if (++commits === 1) {
      f.revoke()
    }
    return result
  })
  await f.submit(id)
  await f.host.drain()
  expect(commits).toBeGreaterThanOrEqual(1)
  expect(f.run).not.toHaveBeenCalled()
  expect(f.record(id).lease).toMatchObject({
    claimStatus: 'released',
    ownerProcess: null,
    deathEvidence: { kind: 'exit-observed' }
  })
  expect(f.store.hive.get(id)?.aggregate.generation?.state).toBe('UNKNOWN')
})
it('releases an idle owned process before deleting its journal', async () => {
  const f = await fixture()
  const id = await f.create()
  await f.submit(id)
  await f.host.drain()
  expect(
    await f.host.call(
      'hiveAgent.delete',
      { sessionId: id, operationId: f.operationId() },
      f.principal
    )
  ).toMatchObject({ ok: true })
  expect(f.record(id).lease.claimStatus).toBe('released')
  expect(f.store.hive.get(id)?.deletionComplete).toBe(true)
})
it('renews by fresh IPC identity during inference and cancels on revoked ownership', async () => {
  let entered!: () => void
  const opened = new Promise<void>((resolve) => {
    entered = resolve
  })
  let signal: AbortSignal | undefined
  const f = await fixture({
    async *run(input) {
      signal = input.signal
      entered()
      yield { type: 'text', text: 'live' }
      await new Promise<void>((resolve) => {
        if (input.signal.aborted) {
          resolve()
        } else {
          input.signal.addEventListener('abort', () => resolve(), { once: true })
        }
      })
    }
  })
  const id = await f.create()
  await f.submit(id)
  await opened
  const before = f.record(id).lease.lastRenewedAt
  f.advance(10000)
  await f.execution.renewNow()
  expect(f.record(id).lease.lastRenewedAt).toBe(before + 10000)
  expect(f.record(id).lease.claimStatus).toBe('live')
  expect(signal?.aborted).toBe(false)
  f.revoke()
  await f.execution.renewNow()
  await f.host.drain()
  await f.execution.release(id)
  expect(signal?.aborted).toBe(true)
  expect(f.record(id).lease).toMatchObject({ claimStatus: 'released', ownerProcess: null })
  expect(f.run).toHaveBeenCalledTimes(1)
})
it('acquires a fresh fence after cancellation and completes a new turn without replaying the old one', async () => {
  let entered!: () => void
  const opened = new Promise<void>((resolve) => {
    entered = resolve
  })
  const f = await fixture({
    async *run(input) {
      entered()
      yield { type: 'text', text: 'cancelled partial' }
      await new Promise<void>((resolve) => {
        if (input.signal.aborted) {
          resolve()
        } else {
          input.signal.addEventListener('abort', () => resolve(), { once: true })
        }
      })
    }
  })
  const id = await f.create()
  await f.submit(id)
  await opened
  const generationId = f.store.hive.get(id)!.aggregate.generation!.generationId
  expect(
    await f.host.call(
      'hiveAgent.cancel',
      { sessionId: id, generationId, operationId: f.operationId() },
      f.principal
    )
  ).toMatchObject({ ok: true })
  await f.host.drain()
  expect(f.record(id).lease).toMatchObject({ runtimeFence: 2, claimStatus: 'released' })
  f.run.mockImplementationOnce(async function* () {
    yield { type: 'text', text: 'fresh turn' }
    yield { type: 'completed', text: 'fresh turn' }
  })
  expect(await f.submit(id)).toMatchObject({ ok: true })
  await f.host.drain()
  expect(f.store.hive.get(id)?.aggregate.generation?.state).toBe('COMPLETED')
  expect(f.record(id).lease).toMatchObject({ runtimeFence: 3, claimStatus: 'live' })
  expect(f.record(id).providerHandleChain).toHaveLength(2)
  expect(f.run).toHaveBeenCalledTimes(2)
})
it('recycles confirmed idle processes within the five-child bound', async () => {
  const f = await fixture()
  const ids: string[] = []
  for (let index = 0; index < 6; index++) {
    const id = await f.create()
    ids.push(id)
    expect(await f.submit(id)).toMatchObject({ ok: true })
    await f.host.drain()
    expect(f.store.hive.get(id)?.aggregate.generation?.state).toBe('COMPLETED')
  }
  expect(f.record(ids[0]).lease.claimStatus).toBe('released')
  expect(
    f.store.listRecords().filter((record) => record.lease.claimStatus === 'live')
  ).toHaveLength(5)
  expect(f.run).toHaveBeenCalledTimes(6)
})
it('reconciles a released Pi lease on restart without touching external-provider records', async () => {
  const f = await fixture()
  const id = await f.create()
  await f.submit(id)
  await f.host.drain()
  const operationId = f.operationId()
  await f.store.reserveOwner({
    sessionId: 'external_session_1',
    provider: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: f.directory },
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'external-folder',
      workspaceKind: 'folder'
    },
    runtimeKind: 'native',
    expectedFence: null,
    spawnToken: randomUUID(),
    claimKeyId: 'external-key',
    handoffOperationId: operationId,
    probe: { outcome: 'indeterminate', reason: 'fixture reservation' },
    operation: { callerKey: 'external-fixture', operationId, fingerprint: 'external-reservation' },
    now: Date.now()
  })
  await f.host.close()
  const restarted = await openTestAgentSessionRecordStore(f.directory)
  expect(restarted.getRecord(managedPiExecutionRecordId(id))?.lease.unreconciled).toBe(true)
  const external = structuredClone(restarted.getRecord('external_session_1'))
  const execution = await createManagedPiExecutionHost({
    ...f.leaseOptions(id),
    store: restarted,
    runtimeRecordId: 'actual_pi_host',
    scopeFor: (entry) => ({
      ...f.leaseOptions(id).scope,
      sessionId: entry.aggregate.session.sessionId
    }),
    assertAuthorized: () => {},
    inference: { run: f.run }
  })
  disposers.push(execution.close)
  expect(restarted.getRecord(managedPiExecutionRecordId(id))?.lease).toMatchObject({
    unreconciled: false,
    claimStatus: 'released',
    runtimeFence: 2
  })
  expect(restarted.getRecord('external_session_1')).toEqual(external)
  expect(restarted.listRecords()).toHaveLength(2)
  expect(f.run).toHaveBeenCalledTimes(1)
})
it('serializes simultaneous identity challenges for the same actual owned child', async () => {
  const f = await fixture()
  const id = await f.create()
  const lease = await reserveManagedPiExecutionLease(f.leaseOptions(id))
  const supervisor = await openManagedPiProcessSupervisor({
    pack,
    home: lease.home,
    ownership: lease.ownership
  })
  disposers.push(supervisor.dispose)
  const identities = await Promise.all(Array.from({ length: 4 }, () => supervisor.verify()))
  expect(identities.every((identity) => identity.pid === supervisor.identity.pid)).toBe(true)
  lease.assertLive()
  expect(f.run).not.toHaveBeenCalled()
})
