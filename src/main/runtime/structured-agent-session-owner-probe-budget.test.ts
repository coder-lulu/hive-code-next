import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionOwnerProbe } from '../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { commitAgentSessionReservation } from './agent-session-reservation-admission'
import type { probeAgentSessionProcessIdentities } from './agent-session-process-identity-probe'
import { createStructuredAgentSessionOwnerProbes } from './structured-agent-session-owner-probe'
import { taskStructuredFixture } from '../tasks/task-structured-reservation.test-fixture'
import { hasTaskSessionBinding } from '../tasks/task-session-association'
import type { TaskExecutionRecord } from '../tasks/task-execution-record'

const UNVERIFIABLE: AgentSessionOwnerProbe = { outcome: 'execution-host-unverifiable' }

function probeFixture(taskCount = 8) {
  const original = taskStructuredFixture()
  const reserved = commitAgentSessionReservation(original.state, original.request, 30_000).record
  const task = original.state.taskExecutions?.get(original.key)
  if (!task?.structuredBinding || !reserved.taskSource) {
    throw new Error('original Task reservation binding missing')
  }
  const binding = task.structuredBinding
  const tasks = new Map<string, TaskExecutionRecord>()
  const records = new Map<string, AgentSessionRecord>()
  const taskRecords = Array.from({ length: taskCount }, (_, index) => {
    const sessionId = `session-task-${index}`
    const record = { ...reserved, sessionId, lease: { ...reserved.lease, sessionId } }
    records.set(sessionId, record)
    tasks.set(sessionId, {
      ...task,
      structuredBinding: { ...binding, sessionId }
    })
    return record
  })
  const { taskSource: _taskSource, ...base } = reserved
  const personal: AgentSessionRecord = {
    ...base,
    sessionId: 'session-personal',
    lease: {
      ...base.lease,
      sessionId: 'session-personal',
      ownerProcess: { hostId: 'local', pid: 4242, processStartTimeMs: 1, spawnToken: 'personal' }
    }
  }
  records.set(personal.sessionId, personal)
  const classify = (record: AgentSessionRecord): 'personal' | 'task' | 'unverifiable' => {
    if (records.get(record.sessionId) !== record) {
      return 'unverifiable'
    }
    return hasTaskSessionBinding(tasks, record.sessionId) ? 'task' : 'personal'
  }
  const pending = taskRecords.map(() => Promise.withResolvers<AgentSessionOwnerProbe | null>())
  const probe = vi.fn((record: AgentSessionRecord) => {
    const index = taskRecords.indexOf(record)
    const deferred = pending[index]
    if (!deferred) {
      throw new Error('only original Task records can reach Docker')
    }
    return deferred.promise
  })
  const pidBatch = vi.fn(
    async (_args: Parameters<typeof probeAgentSessionProcessIdentities>[0]) => [
      { outcome: 'pid-absent' as const }
    ]
  )
  const probeOne = vi.fn(async () => ({ outcome: 'reservation-unused' as const }))
  const batch = createStructuredAgentSessionOwnerProbes('local', pidBatch, probeOne, {
    classify,
    probe
  })
  return { taskRecords, personal, pending, probe, pidBatch, probeOne, batch, records }
}

afterEach(() => vi.useRealTimers())

describe('bounded Task owner batch', () => {
  it('starts personal PID work immediately and runs at most four Task probes', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
    const fixture = probeFixture()
    const result = fixture.batch([...fixture.taskRecords, fixture.personal])
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.pidBatch).toHaveBeenCalledOnce()
    expect(fixture.pidBatch.mock.calls[0]?.[0]).toMatchObject({
      identities: [fixture.personal.lease.ownerProcess]
    })
    expect(fixture.probe).toHaveBeenCalledTimes(4)
    fixture.pending[0]?.resolve(UNVERIFIABLE)
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.probe).toHaveBeenCalledTimes(5)
    await vi.advanceTimersByTimeAsync(15_000)
    expect((await result).get(fixture.personal.sessionId)).toEqual({ outcome: 'pid-absent' })
  })

  it('ends the entire Task round at 15s without starting remaining queued work', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
    const fixture = probeFixture(12)
    let settled = false
    const result = fixture.batch(fixture.taskRecords).then((value) => {
      settled = true
      return value
    })
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    expect(fixture.probe).toHaveBeenCalledTimes(4)
    expect([...(await result).values()]).toEqual(fixture.taskRecords.map(() => UNVERIFIABLE))
  })

  it('observes late fulfillment/rejection without changing results or accumulating another batch', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
    const fixture = probeFixture()
    const first = fixture.batch(fixture.taskRecords)
    await vi.advanceTimersByTimeAsync(15_000)
    const result = await first
    const second = fixture.batch([...fixture.taskRecords, fixture.personal])
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.probe).toHaveBeenCalledTimes(4)
    expect((await second).get(fixture.personal.sessionId)).toEqual({ outcome: 'pid-absent' })
    const record = fixture.taskRecords[0]
    if (!record?.taskSource || !record.lease.reservedSpawnToken) {
      throw new Error('original Task witness missing')
    }
    fixture.pending[0]?.resolve({
      outcome: 'execution-host-exited',
      witness: {
        sessionId: record.sessionId,
        hostId: 'local',
        source: record.taskSource,
        ownerFence: record.lease.runtimeFence,
        spawnToken: record.lease.reservedSpawnToken,
        daemonId: 'original-daemon',
        containerId: 'a'.repeat(64),
        imageId: `sha256:${'b'.repeat(64)}`
      }
    })
    fixture.pending[1]?.reject(new Error('late daemon loss'))
    await vi.advanceTimersByTimeAsync(0)
    expect([...result.values()]).toEqual(fixture.taskRecords.map(() => UNVERIFIABLE))
    expect(fixture.probe).toHaveBeenCalledTimes(4)
  })

  it('maps rejected, thrown and null Task probes to unverifiable without native fallback', async () => {
    const fixture = probeFixture(3)
    fixture.probe.mockImplementationOnce(() => Promise.reject(new Error('daemon unavailable')))
    fixture.probe.mockImplementationOnce(() => {
      throw new Error('Docker port failed before returning')
    })
    fixture.pending[2]?.resolve(null)
    const result = await fixture.batch(fixture.taskRecords)
    expect([...result.values()]).toEqual(fixture.taskRecords.map(() => UNVERIFIABLE))
    expect(fixture.probeOne).not.toHaveBeenCalled()
  })

  it('never sends stripped Task source or an unknown record to the native PID batch', async () => {
    const fixture = probeFixture(1)
    const record = fixture.taskRecords[0]
    if (!record) {
      throw new Error('original Task record missing')
    }
    delete record.taskSource
    fixture.pending[0]?.resolve(UNVERIFIABLE)
    const unknown = { ...fixture.personal, sessionId: 'session-unknown' }
    const result = await fixture.batch([record, unknown])
    expect([...result.values()]).toEqual([UNVERIFIABLE, UNVERIFIABLE])
    expect(fixture.pidBatch).toHaveBeenCalledWith({
      identities: [],
      deps: { readEchoedSpawnToken: expect.any(Function) }
    })
    expect(fixture.probeOne).not.toHaveBeenCalled()
  })
})
