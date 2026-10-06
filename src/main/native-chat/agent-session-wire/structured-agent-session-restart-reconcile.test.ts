import { rm } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { createRestartReconciler } from './structured-agent-session-restart-reconcile'
import { openTestAgentSessionRecordStore } from '../../runtime/agent-session-record-store-test-harness'
import { taskStructuredFixture } from '../../tasks/task-structured-reservation.test-fixture'
import {
  taskTestDirectory,
  taskWorkspace,
  TASK_TEST_NOW
} from '../../tasks/task-execution.test-fixture'

async function unresolvedTaskStore(directory: string) {
  const fixture = taskStructuredFixture(taskWorkspace(directory))
  let store = await openTestAgentSessionRecordStore(directory)
  await store.tasks.admit(fixture.admission)
  await store.tasks.beginDispatch(fixture.command, TASK_TEST_NOW, fixture.validate)
  await store.admitOperation({
    callerKey: fixture.outer.callerKey,
    operationId: fixture.outer.operationId,
    fingerprint: fixture.outer.fingerprint,
    now: TASK_TEST_NOW
  })
  await store.claimOperation(fixture.outer)
  await store.reserveOwner(fixture.request)
  store = await openTestAgentSessionRecordStore(directory)
  return { store, fixture }
}

describe('createRestartReconciler', () => {
  it.each(['fresh-session', 'startup'])(
    'keeps an unverifiable Task fenced without blocking %s',
    async (requested) => {
      const directory = await taskTestDirectory()
      try {
        const { store, fixture } = await unresolvedTaskStore(directory)
        const binding = store.tasks.get(fixture.command)?.structuredBinding
        const reconcile = createRestartReconciler({
          store,
          probe: async () => ({ outcome: 'execution-host-unverifiable' }),
          now: () => TASK_TEST_NOW
        })
        expect(await reconcile(requested)).toBeNull()
        expect(store.listRecords()).toHaveLength(1)
        expect(store.getRecord(fixture.request.sessionId)?.lease.unreconciled).toBe(true)
        expect(store.tasks.get(fixture.command)?.structuredBinding).toEqual(binding)
        expect(await reconcile(fixture.request.sessionId)).toMatchObject({
          code: 'execution_owner_reconciling'
        })
        const reopened = await openTestAgentSessionRecordStore(directory)
        expect(reopened.getRecord(fixture.request.sessionId)?.lease.unreconciled).toBe(true)
        expect(reopened.tasks.get(fixture.command)?.result).toBeNull()
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )
  it('shares the probe flight while answering each original requested target separately', async () => {
    const directory = await taskTestDirectory()
    try {
      const { store, fixture } = await unresolvedTaskStore(directory)
      const reconcile = createRestartReconciler({
        store,
        probe: async () => ({ outcome: 'execution-host-unverifiable' }),
        now: () => TASK_TEST_NOW
      })
      const [fresh, old] = await Promise.all([
        reconcile('fresh-session'),
        reconcile(fixture.request.sessionId)
      ])
      expect(fresh).toBeNull()
      expect(old).toMatchObject({ code: 'execution_owner_reconciling' })
      expect(store.getRecord(fixture.request.sessionId)?.lease.unreconciled).toBe(true)
      const brokenProbe = createRestartReconciler({
        store,
        probe: async () => {
          throw new Error('synthetic probe failure')
        },
        now: () => TASK_TEST_NOW
      })
      await expect(brokenProbe('fresh-session')).rejects.toThrow('synthetic probe failure')
      expect(store.getRecord(fixture.request.sessionId)?.lease.unreconciled).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('reruns after an external store refresh introduces unreconciled leases', async () => {
    let record = { sessionId: 'session-1', lease: { unreconciled: true } } as AgentSessionRecord
    const reconcileOnRestart = vi.fn(async () => {
      record = { ...record, lease: { ...record.lease, unreconciled: false } }
      return new Map()
    })
    const store = {
      listRecords: () => [record],
      getRecord: () => record,
      reconcileOnRestart
    } as unknown as AgentSessionRecordStore
    const reconcile = createRestartReconciler({
      store,
      probe: async () => ({ outcome: 'pid-absent' }),
      now: () => 1
    })

    expect(await reconcile('session-1')).toBeNull()
    record = { ...record, lease: { ...record.lease, unreconciled: true } }
    expect(await reconcile('session-1')).toBeNull()
    expect(reconcileOnRestart).toHaveBeenCalledTimes(2)
  })

  it('passes every pending record through the batch owner probe', async () => {
    let records = [
      { sessionId: 'session-1', lease: { unreconciled: true } },
      { sessionId: 'session-2', lease: { unreconciled: true } }
    ] as AgentSessionRecord[]
    const probe = vi.fn(async () => ({ outcome: 'pid-absent' as const }))
    const probeMany = vi.fn(async (pending: readonly AgentSessionRecord[]) => {
      return new Map(
        pending.map((record) => [record.sessionId, { outcome: 'pid-absent' as const }])
      )
    })
    const reconcileOnRestart = vi.fn(
      async (args: {
        probeMany?: (
          pending: readonly AgentSessionRecord[]
        ) => Promise<Map<string, { outcome: 'pid-absent' }>>
      }) => {
        await args.probeMany?.(records)
        records = records.map((record) => ({
          ...record,
          lease: { ...record.lease, unreconciled: false }
        }))
        return new Map()
      }
    )
    const store = {
      listRecords: () => records,
      getRecord: (sessionId: string) =>
        records.find((record) => record.sessionId === sessionId) ?? null,
      reconcileOnRestart
    } as unknown as AgentSessionRecordStore

    await expect(
      createRestartReconciler({ store, probe, probeMany, now: () => 1 })('session-1')
    ).resolves.toBeNull()

    expect(probeMany).toHaveBeenCalledOnce()
    expect(probeMany.mock.calls[0]?.[0].map((record) => record.sessionId)).toEqual([
      'session-1',
      'session-2'
    ])
    expect(probe).not.toHaveBeenCalled()
  })
})
