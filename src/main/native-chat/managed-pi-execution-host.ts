import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { probeAgentSessionProcessIdentity } from '../runtime/agent-session-process-identity-probe'
import {
  reserveManagedPiExecutionLease,
  managedPiExecutionRecordId
} from '../runtime/managed-pi-execution-lease'
import type { ManagedPiSessionScope } from '../runtime/managed-pi-execution-lease'
import type { VerifiedManagedPiPack } from '../runtime/managed-pi-runtime-identity'
import { StructuredAgentSessionLeaseRenewer } from './agent-session-wire/structured-agent-session-lease-renewer'
import { createManagedPiExecutionLeaseLogger } from './managed-pi-execution-lease-logger'
import { createManagedPiTextDriver } from './managed-pi-text-driver'
import { createManagedPiTextAdapter } from './managed-pi-text-adapter'
import type { ManagedPiTextInference } from './managed-pi-inference-pump'
import type { HiveAgentTextAdapter } from './hive-agent-text-adapter'

/** Owns ephemeral process handles only; all sessions and leases remain in the existing store. */
export async function createManagedPiExecutionHost(options: {
  store: AgentSessionRecordStore
  pack: VerifiedManagedPiPack
  runtimeRecordId: string
  homeRoot: string
  claimKeyId: string
  scopeFor: (entry: HiveAgentSessionEntry) => ManagedPiSessionScope
  assertAuthorized: (scope: ManagedPiSessionScope) => void
  inference: ManagedPiTextInference
  now: () => number
}) {
  const { store, pack, runtimeRecordId } = options
  if (
    store.hostId !== 'local' ||
    typeof options.inference?.run !== 'function' ||
    typeof options.scopeFor !== 'function' ||
    typeof options.assertAuthorized !== 'function'
  ) {
    throw new Error('hive_agent_capability_unavailable')
  }
  await store.reconcileOnRestart({
    owns: (record) =>
      record.provider === 'managed-pi' && record.options?.runtimeRecordId === runtimeRecordId,
    probe: (record) =>
      record.lease.ownerProcess
        ? probeAgentSessionProcessIdentity({ identity: record.lease.ownerProcess })
        : Promise.resolve({
            outcome: 'indeterminate',
            reason: 'no owned child is available after restart'
          }),
    now: options.now()
  })
  type Owned = {
    lease: Awaited<ReturnType<typeof reserveManagedPiExecutionLease>>
    driver: Awaited<ReturnType<typeof createManagedPiTextDriver>>
    renewer: StructuredAgentSessionLeaseRenewer
    dispose: () => Promise<void>
  }
  const handles = new Map<string, Promise<Owned>>()
  let closed = false
  const scopeFor = (sessionId: string) => {
    const entry = store.hive.get(sessionId)
    if (!entry || closed) {
      throw new Error('hive_agent_capability_unavailable')
    }
    const scope = Object.freeze({ ...options.scopeFor(entry) })
    if (
      scope.sessionId !== sessionId ||
      scope.accountId !== entry.accountId ||
      scope.deviceId !== entry.deviceId ||
      scope.projectScope !== entry.projectScope ||
      scope.runtimeRecordId !== options.runtimeRecordId
    ) {
      throw new Error('hive_agent_forbidden')
    }
    options.assertAuthorized(scope)
    return scope
  }
  const start = async (sessionId: string, signal: AbortSignal): Promise<Owned> => {
    const scope = scopeFor(sessionId)
    const lease = await reserveManagedPiExecutionLease({
      ...options,
      scope,
      assertAuthorized: () => {
        if (closed) {
          throw new Error('hive_agent_capability_unavailable')
        }
        options.assertAuthorized(scope)
      }
    })
    let starting = true
    let renewer: StructuredAgentSessionLeaseRenewer | undefined
    let driver: Owned['driver']
    try {
      driver = await createManagedPiTextDriver({
        pack,
        home: lease.home,
        inference: options.inference,
        ownership: {
          ...lease.ownership,
          async onExit(receipt) {
            await renewer?.stop()
            await lease.ownership.onExit(receipt)
          },
          assertCurrent() {
            if (starting && signal.aborted) {
              throw new Error('hive_agent_outcome_unknown')
            }
            lease.ownership.assertCurrent()
          }
        }
      })
    } catch {
      await lease.markUnprovenStartup()
      throw new Error('hive_agent_capability_unavailable')
    } finally {
      starting = false
    }
    let disposal: Promise<void> | undefined
    const dispose = () => {
      disposal ??= (async () => {
        await renewer?.stop()
        await driver.dispose()
      })()
      return disposal
    }
    renewer = new StructuredAgentSessionLeaseRenewer({
      store,
      now: options.now,
      owns: (record) => record.sessionId === lease.recordId,
      // The managed driver has no generic host child record: each tick verifies its transport.
      holdsLiveChild: () => false,
      validate: () => lease.assertLive(),
      probe: async () => {
        lease.assertLive()
        await driver.verify()
        lease.assertLive()
        return { outcome: 'identity-matched', matchedOn: ['spawn-token'] }
      },
      logger: createManagedPiExecutionLeaseLogger({
        now: options.now,
        recordId: lease.recordId,
        dispose
      })
    })
    try {
      lease.assertLive()
      if (signal.aborted) {
        throw new Error('hive_agent_outcome_unknown')
      }
      renewer.start()
      return { lease, driver, renewer, dispose }
    } catch {
      await dispose()
      throw new Error('hive_agent_capability_unavailable')
    }
  }
  const acquire = async (input: {
    sessionId: string
    generationId: string
    signal: AbortSignal
  }) => {
    scopeFor(input.sessionId)
    if (input.signal.aborted) {
      throw new Error('hive_agent_outcome_unknown')
    }
    const current = store.hive.get(input.sessionId)?.aggregate.generation
    if (current?.generationId !== input.generationId || current.state !== 'RUNNING') {
      throw new Error('hive_agent_outcome_unknown')
    }
    let pending = handles.get(input.sessionId)
    if (pending) {
      const owned = await pending
      try {
        owned.lease.assertLive()
        owned.driver.assertCurrent()
      } catch {
        await owned.dispose()
        if (handles.get(input.sessionId) === pending) {
          handles.delete(input.sessionId)
        }
        pending = handles.get(input.sessionId)
      }
    }
    if (!pending) {
      if (handles.size >= 5) {
        const idle = [...handles.entries()].find(([id]) =>
          ['COMPLETED', 'FAILED', 'CANCELLED'].includes(
            store.hive.get(id)?.aggregate.generation?.state ?? ''
          )
        )
        if (!idle) {
          throw new Error('hive_agent_capability_unavailable')
        }
        await (await idle[1]).dispose()
        if (handles.get(idle[0]) === idle[1]) {
          handles.delete(idle[0])
        }
      }
      pending = start(input.sessionId, input.signal)
      handles.set(input.sessionId, pending)
      void pending.catch(() => {
        if (handles.get(input.sessionId) === pending) {
          handles.delete(input.sessionId)
        }
      })
    }
    const owned = await pending
    const assertCurrent = () => {
      owned.lease.assertLive()
      const generation = store.hive.get(input.sessionId)?.aggregate.generation
      if (
        closed ||
        input.signal.aborted ||
        generation?.generationId !== input.generationId ||
        generation.state !== 'RUNNING'
      ) {
        throw new Error('hive_agent_outcome_unknown')
      }
    }
    try {
      assertCurrent()
    } catch {
      await owned.dispose()
      throw new Error('hive_agent_outcome_unknown')
    }
    return { fence: owned.lease.fence, assertCurrent }
  }
  const core = await createManagedPiTextAdapter({
    pack,
    runtimeRecordId: options.runtimeRecordId,
    driver: {
      async *run(input) {
        const pending = handles.get(input.sessionId)
        if (!pending) {
          throw new Error('hive_agent_capability_unavailable')
        }
        const owned = await pending
        owned.lease.assertLive()
        yield* owned.driver.run(input)
      }
    }
  })
  let acquisition = Promise.resolve()
  const adapter: HiveAgentTextAdapter = {
    ...core,
    acquireExecution(input) {
      const result = acquisition.then(() => acquire(input))
      acquisition = result.then(
        () => {},
        () => {}
      )
      return result
    }
  }
  const release = async (sessionId: string) => {
    const pending = handles.get(sessionId)
    if (!pending) {
      const recordId = managedPiExecutionRecordId(sessionId)
      const record = store.getRecord(recordId)
      if (
        store.isSessionUnreadable(recordId) ||
        (record && (record.lease.unreconciled || record.lease.claimStatus !== 'released'))
      ) {
        throw new Error('hive_agent_outcome_unknown')
      }
      return
    }
    const owned = await pending
    await owned.dispose()
    if (handles.get(sessionId) === pending) {
      handles.delete(sessionId)
    }
  }
  let closing: Promise<void> | undefined
  const close = () => {
    closed = true
    closing ??= (async () => {
      const results = await Promise.allSettled(
        [...handles.values()].map(async (pending) => (await pending).dispose())
      )
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('hive_agent_outcome_unknown')
      }
      handles.clear()
    })()
    return closing
  }
  return Object.freeze({
    adapter,
    readPack: pack.readPack.bind(pack),
    async renewNow() {
      if (closed) {
        throw new Error('hive_agent_capability_unavailable')
      }
      await Promise.all(
        [...handles.values()].map(async (pending) => (await pending).renewer.renewNow())
      )
    },
    fenceFor: (entry: HiveAgentSessionEntry) =>
      store.getRecord(managedPiExecutionRecordId(entry.aggregate.session.sessionId))?.lease
        .runtimeFence ?? 1,
    release,
    close
  })
}
