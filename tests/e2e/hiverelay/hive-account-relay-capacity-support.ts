import { expect, vi } from 'vitest'
import type WebSocket from 'ws'
import type { CloudStatus } from './hive-account-relay-capacity-types'

export type { CloudStatus, RuntimeFixture } from './hive-account-relay-capacity-types'

export async function safeFailureSymbols(response: Response): Promise<string> {
  try {
    const body: unknown = await response.clone().json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return ''
    }
    const symbols: Record<string, string> = {}
    for (const key of ['code', 'category', 'reasonCode', 'reason', 'field']) {
      const value = (body as Record<string, unknown>)[key]
      if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(value)) {
        symbols[key] = value
      }
    }
    return JSON.stringify(symbols)
  } catch {
    return ''
  }
}

export function observeRevocationPending(
  status: CloudStatus,
  ids: string[],
  record: (event: Record<string, unknown>) => void
) {
  const pending = status.runtimes
    .flatMap((runtime) => runtime.sessions)
    .filter(
      (session) => ids.includes(session.runtimeSessionId) && session.status === 'REVOKE_PENDING'
    )
  if (pending.length) {
    record({ event: 'revocation-pending-observed', sessions: pending })
  }
}

export function assertWorkerConvergence(
  before: CloudStatus,
  after: CloudStatus,
  ids: string[],
  events: Record<string, unknown>[]
) {
  expect(events.some((event) => event.event === 'revocation-pending-observed')).toBe(true)
  expect(
    after.runtimes
      .flatMap((runtime) => runtime.sessions)
      .some((session) => ids.includes(session.runtimeSessionId) && session.status !== 'CLOSED')
  ).toBe(true)
  expect(
    after.workers!.revocationsProjected +
      after.workers!.sessionsExpired -
      before.workers!.revocationsProjected -
      before.workers!.sessionsExpired
  ).toBeGreaterThan(0)
}

export function assertHeartbeatBurst(value: unknown, released = false): Record<string, unknown> {
  expect(value).toMatchObject(
    released
      ? { invoked: true, acquired: true, released: true, lockedRuntimeCount: 30, errors: [] }
      : {
          injection: 'RUNTIME_ROW_LOCK',
          acquired: true,
          lockedRuntimeCount: 30,
          maximumHoldMs: 500
        }
  )
  if (released) {
    expect((value as Record<string, unknown>).heldMs).toBeGreaterThanOrEqual(500)
    expect((value as Record<string, unknown>).heldMs).toBeLessThan(2000)
  }
  return { phase: 'simultaneous-close-fault-injection', ...(value as Record<string, unknown>) }
}

export function observeCapacitySocket(
  socket: WebSocket,
  runtimeId: string,
  role: string,
  recordLifecycle: (event: Record<string, unknown>) => void,
  snapshot: (runtimeId: string) => Record<string, unknown>
): WebSocket {
  socket.once('open', () => recordLifecycle({ runtimeId, role, event: 'socket-open' }))
  if (role === 'host-control') {
    socket.on('message', (raw, binary) => {
      if (binary || Buffer.byteLength(raw.toString()) > 16_384) {
        return
      }
      try {
        const message = JSON.parse(raw.toString())
        if (message.type === 'host-hello-ack') {
          recordLifecycle({
            runtimeId,
            role,
            event: 'control-ack',
            controlGeneration: message.controlGeneration,
            leaseExpiresAt: message.leaseExpiresAt
          })
        }
      } catch {
        // The production parser owns invalid wire messages; diagnostics never dump the wire.
      }
    })
  }
  socket.once('close', (code, bytes) => {
    const reason = bytes.toString()
    recordLifecycle({
      runtimeId,
      role,
      event: 'socket-close',
      code,
      reason: /^[A-Z][A-Z0-9_]{0,63}$/.test(reason) ? reason : 'NON_SYMBOLIC',
      ...snapshot(runtimeId)
    })
  })
  socket.once('error', () => recordLifecycle({ runtimeId, role, event: 'socket-error' }))
  return socket
}
export const assertRuntimeSessions = (
  status: CloudStatus,
  runtimeRecordIds: string[],
  runtimeSessionIds: string[],
  expectedStatus: string
) => {
  const managedSessionIds: string[] = []
  for (const [index, runtimeRecordId] of runtimeRecordIds.entries()) {
    const runtime = status.runtimes.find((row) => row.runtimeRecordId === runtimeRecordId)
    const session = runtime?.sessions.find(
      (row) => row.runtimeSessionId === runtimeSessionIds[index]
    )
    expect(session, `Missing Runtime session association for ${runtimeRecordId}`).toBeDefined()
    expect(session!.status).toBe(expectedStatus)
    managedSessionIds.push(session!.sessionId)
  }
  expect(new Set(managedSessionIds).size).toBe(runtimeRecordIds.length)
}

export function capacityFailure(error: unknown) {
  const value = error instanceof Error ? error : new Error('Non-Error capacity failure')
  return {
    name: value.name,
    message: value.message
      .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}/g, '[redacted-jws]')
      .slice(0, 2000),
    location: (value.stack ?? '')
      .split('\n')
      .filter((line) => /^\s+at /.test(line))
      .slice(0, 5)
  }
}

export const capacityDiagnostic = (value: string) =>
  value.replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}/g, '[redacted-jws]')

export function assertTerminalRows(
  rows: CloudStatus['runtimes'][number]['sessions'],
  startedAt: number
) {
  const reasons: Record<string, string[]> = {
    CLOSED: ['CLIENT_CLOSED', 'TRANSPORT_CLOSED'],
    REVOKED: ['REVOKED'],
    UNVERIFIABLE: ['SESSION_AUTHORITY_TIMEOUT'],
    EXPIRED: ['ABSOLUTE_TIMEOUT', 'IDLE_TIMEOUT']
  }
  for (const row of rows) {
    expect(reasons[row.status], `Unexpected terminal state ${row.status}`).toBeDefined()
    expect(reasons[row.status]).toContain(row.terminalReason)
    expect(Date.parse(row.terminalAt!)).toBeGreaterThanOrEqual(startedAt - 1000)
    expect(Date.parse(row.terminalAt!)).toBeLessThanOrEqual(Date.now() + 1000)
  }
}

export function assertHeartbeatSequence(
  events: Record<string, unknown>[],
  current: Record<string, unknown>
) {
  const previous = events.findLast(
    (event) =>
      event.event === 'heartbeat-response' &&
      ['runtimeId', 'heartbeatLeaseId', 'bootId', 'leaseEpoch'].every(
        (key) => event[key] === current[key]
      )
  )
  expect(current.heartbeatLeaseId).toEqual(expect.any(String))
  expect(current.acceptedHeartbeatSeq).toBeGreaterThan(
    (previous?.acceptedHeartbeatSeq as number) ?? 0
  )
}

export function assertOldTerminalSessions(
  status: CloudStatus,
  runtimeRecordIds: string[],
  ids: string[],
  startedAt: number,
  previous?: CloudStatus
) {
  const rows = (source: CloudStatus) =>
    runtimeRecordIds.map((runtimeRecordId, index) => {
      const row = source.runtimes
        .find((runtime) => runtime.runtimeRecordId === runtimeRecordId)
        ?.sessions.find((session) => session.runtimeSessionId === ids[index])
      expect(row).toBeDefined()
      return row!
    })
  assertTerminalRows(rows(status), startedAt)
  if (previous) {
    expect(rows(status)).toEqual(rows(previous))
  }
}

export function assertRecoveredLeases(
  before: CloudStatus,
  after: CloudStatus,
  responses: { runtimeId: string; status: number }[],
  services: { runtimeId: string; runtimeRecordId: string; leaseId: string }[]
) {
  for (const event of responses.filter((response) => response.status === 410)) {
    const service = services.find((row) => row.runtimeId === event.runtimeId)!
    const previous = before.runtimes.find(
      (row) => row.runtimeRecordId === service.runtimeRecordId
    )!.lease!
    const current = after.runtimes.find(
      (row) => row.runtimeRecordId === service.runtimeRecordId
    )!.lease!
    expect(current.heartbeatLeaseId).not.toBe(previous.heartbeatLeaseId)
    expect(current.leaseEpoch).toBeGreaterThan(previous.leaseEpoch)
    expect(service.leaseId).toBe(current.heartbeatLeaseId)
  }
}

export const assertCapacityCellCounts = (
  status: CloudStatus,
  cells: { cellId: string; readObservation(): { metrics: Record<string, number> } }[]
) =>
  vi.waitFor(
    () => {
      for (const expected of status.cells) {
        const metrics = cells
          .find((cell) => cell.cellId === expected.cellId)!
          .readObservation().metrics
        expect(metrics.owners).toBe(expected.assignments)
        expect(metrics.connections).toBe(expected.activeSessions)
        expect(metrics.authenticated).toBe(expected.assignments + 2 * expected.activeSessions)
      }
    },
    { timeout: 5_000, interval: 250 }
  )

export function assertInflightCoverage(events: Record<string, unknown>[], runtimeIds: string[]) {
  const closedAt = events.find((event) => event.event === 'close-during-heartbeat')?.at as number
  expect(Number.isFinite(closedAt)).toBe(true)
  const coveredRuntimeIds = runtimeIds.filter((runtimeId) =>
    events.some(
      (event) =>
        event.runtimeId === runtimeId &&
        (event.event === 'heartbeat-response' ||
          (event.event === 'http-failure' && event.path === '/hive/v1/runtime-heartbeats')) &&
        Number(event.requestStartedAt) <= closedAt &&
        closedAt < Number(event.receivedAt) &&
        events.some(
          (request) =>
            request.event === 'heartbeat-request' &&
            request.runtimeId === runtimeId &&
            request.requestStartedAt === event.requestStartedAt
        )
    )
  )
  expect(coveredRuntimeIds).toEqual(runtimeIds)
  return {
    phase: 'actual-heartbeats-inflight-at-close',
    closedAt,
    coveredRuntimeIds,
    count: coveredRuntimeIds.length
  }
}

export const waitForClosed = (status: () => Promise<CloudStatus>, ids: string[]) =>
  vi.waitFor(
    async () => {
      const sessions = (await status()).runtimes.flatMap((runtime) => runtime.sessions)
      for (const id of ids) {
        expect(sessions.find((session) => session.runtimeSessionId === id)?.status).toBe('CLOSED')
      }
    },
    { timeout: 45_000, interval: 500 }
  )
