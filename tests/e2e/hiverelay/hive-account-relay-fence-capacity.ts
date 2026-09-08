import { expect, vi } from 'vitest'
import type { CapacityClientService } from './hive-account-relay-capacity-client'
import type { FenceFaultInjector } from './hive-account-relay-fence-fault'
import type { CloudStatus } from './hive-account-relay-capacity-types'
import { rejectOldControlCredential } from './hive-account-relay-fence-probe'

export async function runFenceTimeoutScenario(options: {
  runtimeCount: number
  durationSeconds: number
  targetRuntimeId: string
  services: CapacityClientService[]
  cells: { readObservation(): { metrics: Record<string, number> } }[]
  connectedStatus: CloudStatus
  oldSessions: string[]
  ca: Buffer[]
  failures: string[]
  lifecycle: Record<string, unknown>[]
  fault: FenceFaultInjector
  fixtureFetch: <T>(path: string, body?: object) => Promise<T>
  rpcRound: (
    tick: number,
    measure?: boolean,
    selected?: CapacityClientService[]
  ) => Promise<string[]>
  connectServices: (selected?: CapacityClientService[]) => Promise<void>
  closeInOrder: (sessionIds: string[]) => Promise<void>
  recordLifecycle: (event: Record<string, unknown>) => void
}) {
  const target = options.services.find(
    (service) => service.item.identity.runtimeInstanceId === options.targetRuntimeId
  )!
  const targetIndex = options.services.indexOf(target)
  const unaffected = options.services.filter((service) => service !== target)
  const targetStatus = options.connectedStatus.runtimes.find(
    (runtime) => runtime.runtimeRecordId === target.item.tuple.runtimeRecordId
  )!
  const oldAssignment = targetStatus.assignments.find((assignment) =>
    ['ASSIGNED', 'ACTIVE'].includes(assignment.status)
  )!
  expect(oldAssignment).toBeDefined()
  options.fault.start(oldAssignment.assignmentId)
  expect(options.fault.credential?.assignmentId).toBe(oldAssignment.assignmentId)
  const revoke = await options.fixtureFetch<{
    sessionId: string
    assignmentId: string
    revokeRequestedAt: string
    status: string
  }>('/fixture/fence-revoke', { runtimeRecordId: target.item.tuple.runtimeRecordId })
  expect(revoke).toMatchObject({
    assignmentId: oldAssignment.assignmentId,
    status: 'REVOKE_PENDING'
  })
  const revokeAt = Date.parse(revoke.revokeRequestedAt)
  expect(Number.isFinite(revokeAt)).toBe(true)
  options.recordLifecycle({
    event: 'fence-revoke-requested',
    runtimeId: options.targetRuntimeId,
    assignmentId: oldAssignment.assignmentId,
    sessionId: revoke.sessionId,
    revokeRequestedAt: revoke.revokeRequestedAt
  })
  let fencedStatus: CloudStatus | undefined
  const fenceDeadline = Date.now() + 110_000
  let tick = 0
  while (Date.now() < fenceDeadline) {
    expect(options.failures).toEqual([])
    await options.rpcRound(options.durationSeconds + 100 + tick, true, unaffected)
    const status = await options.fixtureFetch<CloudStatus>('/fixture/status')
    const assignment = status.runtimes
      .find((runtime) => runtime.runtimeRecordId === target.item.tuple.runtimeRecordId)!
      .assignments.find((candidate) => candidate.assignmentId === oldAssignment.assignmentId)
    const delivery = status.privateOps?.deliveries.find(
      (candidate) => candidate.assignmentId === oldAssignment.assignmentId
    )
    if (
      assignment?.status === 'FENCED' &&
      assignment.terminalReason === 'REVOKE_ACK_TIMEOUT' &&
      delivery?.completedAt
    ) {
      fencedStatus = status
      break
    }
    tick += 1
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  expect(fencedStatus, 'Timed out waiting for the real fence delivery').toBeDefined()
  const fenceElapsedMs = Date.now() - revokeAt
  expect(fenceElapsedMs).toBeGreaterThanOrEqual(60_000)
  expect(options.fault.suppressedCommands.length).toBeGreaterThan(0)
  expect(target.client!.isClosed).toBe(true)
  expect(target.presence.getState()).toBe('ONLINE')
  for (const service of unaffected) {
    expect(service.client!.isReady).toBe(true)
    expect(service.presence.getState()).toBe('ONLINE')
    expect(service.host.getStatus()).toBe('registered')
  }
  expect(fencedStatus!.workers!.errors).toEqual([])
  expect(fencedStatus!.privateOps!.transport.errors).toEqual([])
  const receipt = fencedStatus!.privateOps!.transport.receipts.find(
    (candidate) => candidate.assignmentId === oldAssignment.assignmentId
  )
  expect(receipt).toMatchObject({ assignmentId: oldAssignment.assignmentId, result: 'APPLIED' })
  const delivery = fencedStatus!.privateOps!.deliveries.find(
    (candidate) => candidate.assignmentId === oldAssignment.assignmentId
  )!
  expect(delivery.attempts).toBeGreaterThanOrEqual(1)
  expect(delivery.completedAt).toEqual(expect.any(String))
  expect(
    options.lifecycle.some(
      (event) =>
        event.runtimeId === options.targetRuntimeId &&
        event.role === 'host-control' &&
        event.event === 'socket-close' &&
        event.code === 4410
    ),
    'Missing Cell fence 4410 on Host control'
  ).toBe(true)
  for (const role of ['host-data', 'account-client']) {
    expect(
      options.lifecycle.some(
        (event) =>
          event.runtimeId === options.targetRuntimeId &&
          event.role === role &&
          event.event === 'socket-close'
      ),
      `Missing propagated close for ${role}`
    ).toBe(true)
  }
  expect(
    options.lifecycle.some(
      (event) =>
        Number(event.at) >= revokeAt &&
        event.runtimeId !== options.targetRuntimeId &&
        event.event === 'socket-close'
    )
  ).toBe(false)
  expect(options.fault.credential).toBeDefined()
  const oldCredentialProbe = await rejectOldControlCredential(options.fault.credential!, options.ca)
  options.fault.stop()
  let recoveredStatus: CloudStatus | undefined
  await vi.waitFor(
    async () => {
      const status = await options.fixtureFetch<CloudStatus>('/fixture/status')
      const current = status.runtimes
        .find((runtime) => runtime.runtimeRecordId === target.item.tuple.runtimeRecordId)!
        .assignments.find((assignment) => ['ASSIGNED', 'ACTIVE'].includes(assignment.status))
      expect(current?.assignmentId).not.toBe(oldAssignment.assignmentId)
      expect(current!.assignmentEpoch).toBeGreaterThan(oldAssignment.assignmentEpoch)
      expect(target.host.getStatus()).toBe('registered')
      recoveredStatus = status
    },
    { timeout: 45_000, interval: 500 }
  )
  await options.connectServices([target])
  const targetNewSession = (
    await options.rpcRound(options.durationSeconds + 500, true, [target])
  )[0]!
  const newSessions = [...options.oldSessions]
  newSessions[targetIndex] = targetNewSession
  const reconnectedStatus = await options.fixtureFetch<CloudStatus>('/fixture/status')
  expect(reconnectedStatus.activeSessions).toBe(options.runtimeCount)
  const targetSessions = reconnectedStatus.runtimes.find(
    (runtime) => runtime.runtimeRecordId === target.item.tuple.runtimeRecordId
  )!.sessions
  expect(
    targetSessions.find((session) => session.runtimeSessionId === targetNewSession)?.status
  ).toBe('ACTIVE')
  const oldTerminalSession = targetSessions.find(
    (session) => session.runtimeSessionId === options.oldSessions[targetIndex]
  )
  expect(oldTerminalSession).toMatchObject({
    status: 'REVOKED',
    terminalReason: 'REVOKED'
  })
  expect(Date.parse(oldTerminalSession!.terminalAt!)).toBeGreaterThanOrEqual(revokeAt - 1_000)
  expect(Date.parse(oldTerminalSession!.terminalAt!)).toBeLessThanOrEqual(Date.now() + 1_000)
  await options.rpcRound(options.durationSeconds + 501, true)
  const current = recoveredStatus!.runtimes
    .find((runtime) => runtime.runtimeRecordId === target.item.tuple.runtimeRecordId)!
    .assignments.find((assignment) => ['ASSIGNED', 'ACTIVE'].includes(assignment.status))!
  const evidence = {
    runtimeId: options.targetRuntimeId,
    oldAssignmentId: oldAssignment.assignmentId,
    newAssignmentId: current.assignmentId,
    revokeRequestedAt: revoke.revokeRequestedAt,
    fenceElapsedMs,
    oldCredentialProbe,
    suppressedStaleRefreshes: options.fault.suppressedStaleRefreshes,
    receipt,
    delivery,
    unaffectedRuntimeCount: unaffected.length
  }
  await options.closeInOrder(newSessions)
  const finalStatus = await options.fixtureFetch<CloudStatus>('/fixture/status')
  expect(finalStatus.activeSessions).toBe(0)
  const finalTargetSessions = finalStatus.runtimes.find(
    (runtime) => runtime.runtimeRecordId === target.item.tuple.runtimeRecordId
  )!.sessions
  expect(
    finalTargetSessions.find(
      (session) => session.runtimeSessionId === options.oldSessions[targetIndex]
    )
  ).toEqual(oldTerminalSession)
  const finalNewSession = finalTargetSessions.find(
    (session) => session.runtimeSessionId === targetNewSession
  )
  expect(finalNewSession).toMatchObject({ status: 'CLOSED' })
  expect(['CLIENT_CLOSED', 'TRANSPORT_CLOSED']).toContain(finalNewSession!.terminalReason)
  expect(Date.parse(finalNewSession!.terminalAt!)).toBeLessThanOrEqual(Date.now() + 1_000)
  expect(finalStatus.workers!.errors).toEqual([])
  expect(finalStatus.privateOps!.transport.errors).toEqual([])
  await Promise.all(options.services.map((service) => service.presence.stop()))
  await Promise.all(options.services.map((service) => service.host.stop()))
  await vi.waitFor(
    () => {
      for (const cell of options.cells) {
        for (const key of ['preauth', 'authenticated', 'owners', 'connections', 'ingress_bytes']) {
          expect(cell.readObservation().metrics[key]).toBe(0)
        }
      }
    },
    { timeout: 15_000, interval: 250 }
  )
  return { terminalStatus: fencedStatus!, reconnectedStatus, finalStatus, newSessions, evidence }
}
